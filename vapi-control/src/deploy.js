// CLI: render the assistant and create/update it in Vapi.
//   node src/deploy.js            -> create (or update if VAPI_ASSISTANT_ID is set)
//   node src/deploy.js --dry-run  -> print rendered JSON without calling Vapi
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { renderAssistant } from "./render.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const assistant = renderAssistant();
  if (dryRun) { console.log(JSON.stringify(assistant, null, 2)); return; }

  const { vapi } = await import("./vapiClient.js");
  const id = process.env.VAPI_ASSISTANT_ID;
  if (id) {
    const updated = await vapi.updateAssistant(id, assistant);
    console.log(`✔ Updated assistant ${id}`);
    console.log(`  Voice: ${updated.voice?.provider}/${updated.voice?.voiceId} speed=${updated.voice?.speed}`);
  } else {
    const created = await vapi.createAssistant(assistant);
    console.log(`✔ Created assistant ${created.id}`);
    console.log(`  Add to .env:  VAPI_ASSISTANT_ID=${created.id}`);
  }
}

main().catch(e => { console.error("Deploy failed:", e.message); process.exit(1); });
