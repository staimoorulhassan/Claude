// Control + webhook server for the Vapi pharmacy lead-gen assistant.
//
//   GET  /health                 -> liveness
//   POST /deploy                  -> re-render from template/.env and update the assistant   [admin]
//   POST /swap                    -> hot-swap LLM / voice / transcriber                       [admin]
//   POST /vapi                    -> Vapi server-url webhook (end-of-call-report, status, transfer)
//
// Admin endpoints require:  Authorization: Bearer <CONTROL_ADMIN_TOKEN>
// The /vapi webhook is verified with the shared SERVER_SECRET (x-vapi-secret header).
//
// PRIVACY: Vapi recording is disabled in the assistant config (recordingEnabled: false).
// All lead data from end-of-call-report is stored in local SQLite/JSON logs ONLY.
// No lead PII is forwarded to Vapi or any third-party beyond what's needed for the call.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { renderAssistant, buildSwapPatch } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", "config", ".env") });

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.CONTROL_PORT || 8080;
const ADMIN = process.env.CONTROL_ADMIN_TOKEN;
const WEBHOOK_SECRET = process.env.SERVER_SECRET;
const ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const AVR_AMI_URL = process.env.AVR_AMI_URL || null;

// ── Local lead log ────────────────────────────────────────────────────────────
// All call outcomes are written here. This is the ONLY place call data is stored.
const LEADS_LOG = path.resolve(__dirname, "..", "..", "..", "data", "leads.jsonl");
fs.mkdirSync(path.dirname(LEADS_LOG), { recursive: true });

function appendLead(record) {
  fs.appendFileSync(LEADS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!ADMIN || tok !== ADMIN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// ── avr-ami bridge: trigger an Asterisk-level transfer ───────────────────────
// This is the reliable alternative to Vapi's Twilio-dependent warm-transfer.
// vapi-control calls this when a lead qualifies and a transferCall is needed.
async function triggerAMITransfer(uuid, extension, context = "verifier-transfer") {
  if (!AVR_AMI_URL || !uuid) return null;
  const res = await fetch(`${AVR_AMI_URL}/transfer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uuid, extension, context, priority: 1 }),
  });
  return res.ok ? await res.json() : null;
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ ok: true, assistantId: ASSISTANT_ID || null }));

// View local leads log (admin only)
app.get("/leads", requireAdmin, (_req, res) => {
  if (!fs.existsSync(LEADS_LOG)) return res.json([]);
  const lines = fs.readFileSync(LEADS_LOG, "utf8").trim().split("\n").filter(Boolean);
  const leads = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  res.json(leads);
});

// Re-deploy the whole assistant from the current template + .env
app.post("/deploy", requireAdmin, async (req, res) => {
  try {
    const { vapi } = await import("./vapiClient.js");
    const assistant = renderAssistant();
    if (!ASSISTANT_ID) return res.status(400).json({ error: "set VAPI_ASSISTANT_ID first (run npm run deploy)" });
    const updated = await vapi.updateAssistant(ASSISTANT_ID, assistant);
    res.json({ ok: true, voice: updated.voice, model: { provider: updated.model?.provider, model: updated.model?.model } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Hot-swap provider/voice/transcriber — no code edits needed.
// Body: { llm?, voice?, transcriber? }
// e.g. { "voice": { "provider": "vapi", "voiceId": "Savannah", "speed": 1.2 } }
//      { "llm":   { "provider": "anthropic", "model": "claude-sonnet-4-6" } }
app.post("/swap", requireAdmin, async (req, res) => {
  try {
    const { vapi } = await import("./vapiClient.js");
    if (!ASSISTANT_ID) return res.status(400).json({ error: "set VAPI_ASSISTANT_ID first" });
    const patch = buildSwapPatch(req.body || {});
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "nothing to swap (send llm/voice/transcriber)" });
    const updated = await vapi.updateAssistant(ASSISTANT_ID, patch);
    res.json({ ok: true, applied: patch, voice: updated.voice, model: { provider: updated.model?.provider, model: updated.model?.model } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Vapi server-url webhook — receives call events.
// IMPORTANT: Vapi recording is disabled (recordingEnabled: false in assistant.vapi.json).
// Call summaries and transcripts exist only while Vapi processes the call. The only
// persistent store is our local LEADS_LOG file (data/leads.jsonl).
app.post("/vapi", async (req, res) => {
  if (WEBHOOK_SECRET && req.headers["x-vapi-secret"] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "bad webhook secret" });
  }

  const msg = req.body?.message || {};

  switch (msg.type) {

    case "end-of-call-report": {
      // Extract outcome from call analysis or toolCallResults
      const analysis = msg.analysis || {};
      const lead = {
        callId: msg.call?.id,
        callUUID: msg.call?.assistantOverrides?.variableValues?.callUuid || null,
        phone: msg.customer?.number || null,
        outcome: analysis.structuredData?.outcome || "UNKNOWN",
        first_name: analysis.structuredData?.first_name || null,
        takes_medications: analysis.structuredData?.takes_medications || null,
        us_resident: analysis.structuredData?.us_resident || null,
        age_18_plus: analysis.structuredData?.age_18_plus || null,
        coverage_type: analysis.structuredData?.coverage_type || null,
        interested: analysis.structuredData?.interested || null,
        durationSeconds: msg.durationSeconds || null,
      };

      // Store locally — this is the ONLY persistent store
      appendLead(lead);
      console.log("[lead captured]", lead.outcome, lead.phone ? "✔" : "(no phone)");

      // If eligible and AVR_AMI_URL is configured: trigger Asterisk-level transfer
      // (fallback to Vapi transferCall if avr-ami is not configured)
      if (lead.outcome === "TRANSFERRED" && lead.callUUID && AVR_AMI_URL) {
        const amiResult = await triggerAMITransfer(lead.callUUID, "verifier");
        console.log("[avr-ami transfer]", amiResult ? "ok" : "skipped (no UUID or AMI URL)");
      }

      // TODO: push disposition back to ViciDial via its API here
      // await pushViciDialDisposition(lead.phone, lead.outcome);

      break;
    }

    case "status-update":
      console.log("[status]", msg.status, msg.call?.id);
      break;

    case "transfer-destination-request":
      // Return a dynamic verifier number if you route to multiple verifiers.
      // Default: use the static VERIFIER_NUMBER from .env.
      return res.json({ destination: { type: "number", number: process.env.VERIFIER_NUMBER } });

    default:
      break;
  }

  res.json({ received: true });
});

app.listen(PORT, () => console.log(`vapi-control listening on :${PORT}  | local leads log: ${LEADS_LOG}`));
