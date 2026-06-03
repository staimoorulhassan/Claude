// Lead Generation Hub — control API
// Role in new architecture:
//   1. Receives Vapi voice-AI webhooks (end-of-call, transfer-destination-request)
//   2. On transfer: signals avr-ami → ViciDial AMI → dials verifier (3-way)
//   3. Stores qualified leads (local JSONL / /tmp on Vercel)
//   4. Admin endpoints: /health /leads /swap
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { renderAssistant, buildSwapPatch } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.VERCEL) {
  dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
}

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT             = process.env.CONTROL_PORT || 8080;
const ADMIN            = process.env.CONTROL_ADMIN_TOKEN;
const WEBHOOK_SECRET   = process.env.SERVER_SECRET;
const ASSISTANT_ID     = process.env.VAPI_ASSISTANT_ID;
const PHONE_NUMBER_ID  = process.env.VAPI_PHONE_NUMBER_ID || null;
const VERIFIER_NUMBER  = process.env.VERIFIER_NUMBER;
const AVR_AMI_URL      = process.env.AVR_AMI_URL || null;  // http://avr-ami:3002

// Lead storage — /tmp on Vercel (ephemeral), data/ locally
const LEADS_LOG = process.env.VERCEL
  ? "/tmp/leads.jsonl"
  : path.resolve(__dirname, "..", "..", "data", "leads.jsonl");

if (!process.env.VERCEL) {
  fs.mkdirSync(path.dirname(LEADS_LOG), { recursive: true });
}

function appendLead(record) {
  try {
    fs.appendFileSync(LEADS_LOG,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
  } catch { /* /tmp may not persist across Vercel cold-starts */ }
}

function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!ADMIN || tok !== ADMIN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// Signal avr-ami to trigger ViciDial 3-way conference
async function triggerViciDialTransfer(callUuid, verifierNumber) {
  if (!AVR_AMI_URL || !callUuid) return null;
  try {
    const res = await fetch(`${AVR_AMI_URL}/transfer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uuid: callUuid,
        extension: verifierNumber,
        context: "from-vicidial",
        priority: 1,
      }),
    });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// ── Routes ────────────────────────────────────────────────

app.get("/", (_req, res) => res.json({
  service: "lead-generation-hub",
  status: "ok",
  assistantId: ASSISTANT_ID || null,
  phoneNumberId: PHONE_NUMBER_ID,
}));

app.get("/health", (_req, res) => res.json({
  ok: true,
  assistantId: ASSISTANT_ID || null,
  phoneNumberId: PHONE_NUMBER_ID,
  vercel: !!process.env.VERCEL,
  avrAmi: !!AVR_AMI_URL,
}));

app.get("/leads", requireAdmin, (_req, res) => {
  try {
    if (!fs.existsSync(LEADS_LOG)) return res.json([]);
    const lines = fs.readFileSync(LEADS_LOG, "utf8").trim().split("\n").filter(Boolean);
    res.json(lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  } catch { res.json([]); }
});

// Hot-swap Vapi voice/LLM/STT provider without redeploy
// POST /swap  { llm?, voice?, transcriber? }
app.post("/swap", requireAdmin, async (req, res) => {
  try {
    const { vapi } = await import("./vapiClient.js");
    if (!ASSISTANT_ID) return res.status(400).json({ error: "VAPI_ASSISTANT_ID not set" });
    const patch = buildSwapPatch(req.body || {});
    if (!Object.keys(patch).length) return res.status(400).json({ error: "send llm / voice / transcriber" });
    const updated = await vapi.updateAssistant(ASSISTANT_ID, patch);
    res.json({ ok: true, applied: patch, voice: updated.voice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Vapi webhook ─────────────────────────────────────────
// Vapi sends call lifecycle events here.
// PRIVACY: recordingEnabled=false in assistant. No audio stored anywhere.
app.post("/vapi", async (req, res) => {
  if (WEBHOOK_SECRET && req.headers["x-vapi-secret"] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "bad secret" });
  }

  const msg = req.body?.message || {};

  switch (msg.type) {

    // Lead qualified — Savannah decided to transfer
    case "transfer-destination-request": {
      const callUuid = msg.call?.assistantOverrides?.variableValues?.callUuid
                    || msg.call?.id;

      // Signal ViciDial via avr-ami to do 3-way conference to verifier
      if (callUuid && AVR_AMI_URL) {
        triggerViciDialTransfer(callUuid, VERIFIER_NUMBER).then(r =>
          console.log("[avr-ami transfer]", r ? "ok" : "failed/not-configured")
        );
      }

      // Tell Vapi the transfer number (fallback — Vapi dials directly if avr-ami unavailable)
      return res.json({
        destination: {
          type: "number",
          number: VERIFIER_NUMBER,
          message: "Please hold — connecting you with a verification specialist.",
        },
      });
    }

    // Call ended — capture lead data
    case "end-of-call-report": {
      const analysis = msg.analysis || {};
      const sd       = analysis.structuredData || {};
      const lead = {
        callId:        msg.call?.id,
        callUUID:      msg.call?.assistantOverrides?.variableValues?.callUuid || null,
        phone:         msg.customer?.number || null,
        outcome:       sd.outcome || "UNKNOWN",
        first_name:    sd.first_name || null,
        takes_meds:    sd.takes_medications || null,
        us_resident:   sd.us_resident || null,
        age_18_plus:   sd.age_18_plus || null,
        coverage_type: sd.coverage_type || null,
        interested:    sd.interested || null,
        durationSec:   msg.durationSeconds || null,
      };
      appendLead(lead);
      console.log("[lead]", lead.outcome, lead.phone ? "✔" : "(no phone)");
      break;
    }

    case "status-update":
      console.log("[status]", msg.status);
      break;

    default:
      break;
  }

  res.json({ received: true });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`lead-gen-hub :${PORT}  leads→${LEADS_LOG}`));
}

export default app;
