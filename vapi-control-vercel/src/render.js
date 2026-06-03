// Renders the Vapi assistant by substituting __TOKENS__ from environment variables.
// Self-contained: reads template from ../assets/ so this works on Vercel too.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(__dirname, "..", "assets");
const TEMPLATE_PATH = path.join(ASSETS, "assistant.template.json");

const TOKENS = {
  __COMPANY_NAME__:       "COMPANY_NAME",
  __LLM_PROVIDER__:       "LLM_PROVIDER",
  __LLM_MODEL__:          "LLM_MODEL",
  __VAPI_VOICE_PROVIDER__:"VAPI_VOICE_PROVIDER",
  __VAPI_VOICE_ID__:      "VAPI_VOICE_ID",
  __VAPI_VOICE_SPEED__:   "VAPI_VOICE_SPEED",
  __STT_PROVIDER__:       "STT_PROVIDER",
  __STT_MODEL__:          "STT_MODEL",
  __VERIFIER_NUMBER__:    "VERIFIER_NUMBER",
  __SERVER_URL__:         "SERVER_URL",
  __SERVER_SECRET__:      "SERVER_SECRET",
  __SYSTEM_PROMPT__:      "SYSTEM_PROMPT",   // inject prompt as env var (Vercel-friendly)
};

export function renderAssistant(env = process.env) {
  let raw = fs.readFileSync(TEMPLATE_PATH, "utf8");
  for (const [token, key] of Object.entries(TOKENS)) {
    const val = (env[key] ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    raw = raw.split(token).join(val);
  }
  const assistant = JSON.parse(raw);
  if (assistant.voice?.speed !== undefined) {
    const n = Number(assistant.voice.speed);
    if (Number.isFinite(n)) assistant.voice.speed = n;
    else delete assistant.voice.speed;
  }
  return assistant;
}

export function buildSwapPatch(body = {}) {
  const patch = {};
  if (body.llm) {
    patch.model = { provider: body.llm.provider, model: body.llm.model };
    if (body.llm.temperature !== undefined) patch.model.temperature = body.llm.temperature;
  }
  if (body.voice) {
    patch.voice = { provider: body.voice.provider, voiceId: body.voice.voiceId };
    if (body.voice.speed !== undefined) patch.voice.speed = Number(body.voice.speed);
  }
  if (body.transcriber) {
    patch.transcriber = {
      provider: body.transcriber.provider,
      model: body.transcriber.model,
      language: body.transcriber.language ?? "en",
    };
  }
  return patch;
}
