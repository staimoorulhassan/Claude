// Vapi-control: deploy + hot-swap assistant, receive Vapi webhooks, capture leads locally.
// Runs as a plain Express server locally AND as a Vercel serverless function.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import express from "express";
import { renderAssistant, buildSwapPatch } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env only when running locally (Vercel injects env vars directly)
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
const AVR_AMI_URL      = process.env.AVR_AMI_URL || null;

// Lead storage: /tmp works on Vercel (ephemeral per cold-start — fine for testing;
// use a DB like Vercel Postgres / PlanetScale / Neon for production).
const LEADS_LOG = process.env.VERCEL
  ? "/tmp/leads.jsonl"
  : path.resolve(__dirname, "..", "data", "leads.jsonl");

if (!process.env.VERCEL) {
  fs.mkdirSync(path.dirname(LEADS_LOG), { recursive: true });
}

function appendLead(record) {
  try {
    fs.appendFileSync(LEADS_LOG, JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n");
  } catch { /* /tmp may not persist on Vercel — acceptable for testing */ }
}

function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!ADMIN || tok !== ADMIN) return res.status(401).json({ error: "unauthorized" });
  next();
}

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

app.get("/", (_req, res) => res.json({ service: "vapi-control", status: "ok", assistantId: ASSISTANT_ID || null }));
app.get("/health", (_req, res) => res.json({ ok: true, assistantId: ASSISTANT_ID || null, phoneNumberId: PHONE_NUMBER_ID, vercel: !!process.env.VERCEL }));

app.get("/leads", requireAdmin, (_req, res) => {
  try {
    if (!fs.existsSync(LEADS_LOG)) return res.json([]);
    const lines = fs.readFileSync(LEADS_LOG, "utf8").trim().split("\n").filter(Boolean);
    res.json(lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean));
  } catch { res.json([]); }
});

app.post("/deploy", requireAdmin, async (req, res) => {
  try {
    const { vapi } = await import("./vapiClient.js");
    if (!ASSISTANT_ID) return res.status(400).json({ error: "Set VAPI_ASSISTANT_ID env var first (run deploy script)" });
    const updated = await vapi.updateAssistant(ASSISTANT_ID, renderAssistant());
    res.json({ ok: true, voice: updated.voice, model: { provider: updated.model?.provider, model: updated.model?.model } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Hot-swap provider/voice/transcriber — no redeploy needed.
// POST /swap  body: { llm?, voice?, transcriber? }
// Examples:
//   { "voice": { "provider": "vapi", "voiceId": "Savannah", "speed": 1.2 } }
//   { "llm":   { "provider": "anthropic", "model": "claude-sonnet-4-6" } }
app.post("/swap", requireAdmin, async (req, res) => {
  try {
    const { vapi } = await import("./vapiClient.js");
    if (!ASSISTANT_ID) return res.status(400).json({ error: "Set VAPI_ASSISTANT_ID first" });
    const patch = buildSwapPatch(req.body || {});
    if (!Object.keys(patch).length) return res.status(400).json({ error: "send llm / voice / transcriber to swap" });
    const updated = await vapi.updateAssistant(ASSISTANT_ID, patch);
    res.json({ ok: true, applied: patch, voice: updated.voice });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Vapi server-url webhook.
// PRIVACY: recording is disabled in the assistant. Lead data never leaves this endpoint.
app.post("/vapi", async (req, res) => {
  if (WEBHOOK_SECRET && req.headers["x-vapi-secret"] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "bad secret" });
  }
  const msg = req.body?.message || {};
  switch (msg.type) {
    case "end-of-call-report": {
      const analysis = msg.analysis || {};
      const sd = analysis.structuredData || {};
      const lead = {
        callId:         msg.call?.id,
        callUUID:       msg.call?.assistantOverrides?.variableValues?.callUuid || null,
        phone:          msg.customer?.number || null,
        outcome:        sd.outcome || "UNKNOWN",
        first_name:     sd.first_name || null,
        takes_meds:     sd.takes_medications || null,
        us_resident:    sd.us_resident || null,
        age_18_plus:    sd.age_18_plus || null,
        coverage_type:  sd.coverage_type || null,
        interested:     sd.interested || null,
        durationSec:    msg.durationSeconds || null,
      };
      appendLead(lead);
      console.log("[lead]", lead.outcome, lead.phone ? "✔" : "(no phone)");
      if (lead.outcome === "TRANSFERRED" && lead.callUUID && AVR_AMI_URL) {
        triggerAMITransfer(lead.callUUID, "verifier").then(r =>
          console.log("[avr-ami]", r ? "transfer ok" : "transfer skipped")
        );
      }
      break;
    }
    case "status-update":
      console.log("[status]", msg.status);
      break;
    case "transfer-destination-request":
      return res.json({ destination: { type: "number", number: process.env.VERIFIER_NUMBER } });
    default:
      break;
  }
  res.json({ received: true });
});

// ── Export for Vercel; listen locally ────────────────────────────────────────
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`vapi-control :${PORT}  leads→${LEADS_LOG}`));
}

export default app;
