// Renders the Vapi assistant template by substituting __TOKENS__ from environment
// and (optionally) injecting the canonical system prompt from ai-agent/prompt.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", ".."); // repo .../Lead-Generation-Setup

const TEMPLATE_PATH = path.join(ROOT, "ai-agent", "assistant.vapi.json");
const PROMPT_PATH = path.join(ROOT, "ai-agent", "prompt.md");

// Map of __TOKEN__ -> env var name. Numbers are coerced after substitution.
const TOKENS = {
  __COMPANY_NAME__: "COMPANY_NAME",
  __LLM_PROVIDER__: "LLM_PROVIDER",
  __LLM_MODEL__: "LLM_MODEL",
  __VAPI_VOICE_PROVIDER__: "VAPI_VOICE_PROVIDER",
  __VAPI_VOICE_ID__: "VAPI_VOICE_ID",
  __VAPI_VOICE_SPEED__: "VAPI_VOICE_SPEED",
  __STT_PROVIDER__: "STT_PROVIDER",
  __STT_MODEL__: "STT_MODEL",
  __VERIFIER_NUMBER__: "VERIFIER_NUMBER",
  __SERVER_URL__: "SERVER_URL",
  __SERVER_SECRET__: "SERVER_SECRET",
};

// Pull the fenced ```...``` SYSTEM PROMPT block out of prompt.md.
function extractSystemPrompt(md) {
  const start = md.indexOf("## SYSTEM PROMPT");
  const slice = start >= 0 ? md.slice(start) : md;
  const fence = slice.match(/```([\s\S]*?)```/);
  return fence ? fence[1].trim() : md.trim();
}

export function renderAssistant(env = process.env) {
  let raw = fs.readFileSync(TEMPLATE_PATH, "utf8");

  for (const [token, key] of Object.entries(TOKENS)) {
    const val = env[key] ?? "";
    raw = raw.split(token).join(val);
  }

  const assistant = JSON.parse(raw);
  delete assistant._comment;

  // Coerce the voice speed to a number (Vapi expects a numeric multiplier).
  if (assistant.voice && assistant.voice.speed !== undefined) {
    const n = Number(assistant.voice.speed);
    if (Number.isFinite(n)) assistant.voice.speed = n;
    else delete assistant.voice.speed;
  }

  // Inject the canonical prompt if requested.
  if (String(env.PROMPT_FROM_FILE).toLowerCase() === "true" && fs.existsSync(PROMPT_PATH)) {
    const prompt = extractSystemPrompt(fs.readFileSync(PROMPT_PATH, "utf8"))
      .replaceAll("{{COMPANY_NAME}}", env.COMPANY_NAME ?? "{{COMPANY_NAME}}")
      .replaceAll("{{VERIFIER_NUMBER}}", env.VERIFIER_NUMBER ?? "{{VERIFIER_NUMBER}}");
    assistant.model.messages[0].content = prompt;
  }

  return assistant;
}

// Build only the patch needed to swap LLM / voice / transcriber at runtime.
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
