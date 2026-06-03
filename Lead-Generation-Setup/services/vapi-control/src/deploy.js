// CLI: render the assistant from the template + .env and create/update it in Vapi.
//   npm run deploy            -> create (or update if VAPI_ASSISTANT_ID is set)
//   npm run deploy -- --dry-run  (or: npm run render) -> print the rendered JSON, call nothing
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { renderAssistant } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", "..", "..", "config", ".env") });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const assistant = renderAssistant();

  if (dryRun) {
    console.log(JSON.stringify(assistant, null, 2));
    return;
  }

  // Import lazily so --dry-run works without a key.
  const { vapi } = await import("./vapiClient.js");
  const id = process.env.VAPI_ASSISTANT_ID;

  if (id) {
    const updated = await vapi.updateAssistant(id, assistant);
    console.log(`Updated Vapi assistant ${id}`);
    console.log(`Voice: ${updated.voice?.provider}/${updated.voice?.voiceId} speed=${updated.voice?.speed}`);
  } else {
    const created = await vapi.createAssistant(assistant);
    console.log(`Created Vapi assistant ${created.id}`);
    console.log(`>>> Add this to config/.env:  VAPI_ASSISTANT_ID=${created.id}`);
  }
}

main().catch((err) => {
  console.error("Deploy failed:", err.message);
  process.exit(1);
});
