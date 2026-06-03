// Control + webhook server for the Vapi pharmacy lead-gen assistant.
//
//   GET  /health                 -> liveness
//   POST /deploy                  -> re-render from template/.env and update the assistant   [admin]
//   POST /swap                    -> hot-swap LLM / voice / transcriber                       [admin]
//   POST /vapi                    -> Vapi server-url webhook (end-of-call-report, status, transfer)
//
// Admin endpoints require:  Authorization: Bearer <CONTROL_ADMIN_TOKEN>
// The /vapi webhook is verified with the shared SERVER_SECRET (x-vapi-secret header).
import path from "node:path";
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

function requireAdmin(req, res, next) {
  const tok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!ADMIN || tok !== ADMIN) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/health", (_req, res) => res.json({ ok: true, assistantId: ASSISTANT_ID || null }));

// Re-deploy the whole assistant from the current template + .env.
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

// Hot-swap provider/voice/transcriber. Body: { llm?, voice?, transcriber? }
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

// Vapi calls this during/after calls. Use it to capture leads & decide transfers.
app.post("/vapi", (req, res) => {
  if (WEBHOOK_SECRET && req.headers["x-vapi-secret"] !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "bad webhook secret" });
  }
  const msg = req.body?.message || {};
  switch (msg.type) {
    case "end-of-call-report":
      // TODO: persist the lead to your CRM/DB and push disposition back to ViciDial.
      console.log("[lead] end-of-call", JSON.stringify(msg.analysis || msg.summary || {}));
      break;
    case "status-update":
      console.log("[status]", msg.status);
      break;
    case "transfer-destination-request":
      // Optionally return a dynamic verifier number here instead of the static one.
      return res.json({ destination: { type: "number", number: process.env.VERIFIER_NUMBER } });
    default:
      break;
  }
  res.json({ received: true });
});

app.listen(PORT, () => console.log(`vapi-control listening on :${PORT}`));
