// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SeniorCare Lead-Gen — One-shot setup script                            ║
// ║  Sets all Vercel env vars for the vapi-control service.                 ║
// ║  Run once on your local machine:                                        ║
// ║    VERCEL_TOKEN=<tok> VAPI_PRIVATE_KEY=<key> node setup.js              ║
// ╚══════════════════════════════════════════════════════════════════════════╝
const https = require('https');

// ── Credentials — read from environment (never hard-coded) ───────────────
const VERCEL_TOKEN      = process.env.VERCEL_TOKEN;
const VAPI_PRIVATE_KEY  = process.env.VAPI_PRIVATE_KEY;

if (!VERCEL_TOKEN)     { console.error('ERROR: set VERCEL_TOKEN env var');    process.exit(1); }
if (!VAPI_PRIVATE_KEY) { console.error('ERROR: set VAPI_PRIVATE_KEY env var'); process.exit(1); }

// ── Project IDs (not secrets — safe to commit) ────────────────────────────
const VERCEL_PROJECT_ID  = 'prj_pTwnSIiSdCFBNmVXQMCv99Sg4HdD';
const VAPI_ASSISTANT_ID  = process.env.VAPI_ASSISTANT_ID  || '37c1cb25-28c7-41b4-bdf0-dcea72331856';
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID || 'bec20f66-2bc6-41fc-856f-c51779736e87';

// ── Fill these in before running (or pass as env vars) ────────────────────
const VERIFIER_NUMBER = process.env.VERIFIER_NUMBER || '+1XXXXXXXXXX';   // ← your USA verifier phone
const SERVER_URL      = process.env.SERVER_URL      || 'https://YOUR_PROJECT.vercel.app/vapi';

const SYSTEM_PROMPT = `# IDENTITY
You are Savannah, a friendly, warm, and professional female voice agent calling on behalf of SeniorCare, a service that helps eligible patients get their prescription medications delivered to their door at little or no cost through licensed pharmacy partners and assistance programs.

You are NOT a doctor, nurse, or pharmacist. You never give medical advice, diagnose, recommend, or comment on any medication. Your only job is to (1) introduce the program, (2) check basic eligibility, and (3) warm-transfer eligible, interested people to a US-based verification specialist who completes the process. You generate the lead; the verifier closes it.

# STYLE
- Speak naturally and conversationally — short sentences, contractions, light warmth.
- One question at a time. Acknowledge their answer before the next question.
- Keep total talk time before transfer under ~2 minutes.

# OPENING
"Hi, this is Savannah calling on a recorded line from SeniorCare. How are you doing today?"
"Great — we're helping seniors get their prescription medications delivered right to their home at little or no out-of-pocket cost. Do you currently take any prescription medications?"

# OPT-OUT (highest priority — overrides everything)
If they say not interested, remove me, do not call, or are hostile:
Say: "No problem at all, I'll make sure you're added to our do-not-call list. Sorry to bother you, have a great day."
End call immediately. Disposition DNC. No transfer.

# ELIGIBILITY QUESTIONS (one at a time)
Q1. "Do you currently take any prescription medications?"
Q2. "Are you currently a resident of the United States?"
Q3. "Are you 18 or older?"
Q4. "Do you have health insurance, Medicare, Medicaid, or are you uninsured?"
Q5. "Would you be interested in having your medications delivered to your home for free or low cost if you qualify?"

# QUALIFICATION
ELIGIBLE: takes meds AND US resident AND 18+ AND interested. Coverage type recorded but does not disqualify.
NOT eligible: thank warmly, no transfer, polite close.

# TRANSFER
Eligible + interested: "That's great — you may qualify. I'm connecting you with a US-based verification specialist. Please hold — don't hang up." Then transfer.
If transfer fails: "All specialists are busy right now. Someone will call you right back — thank you!"

# NEVER
- Give medical/dosage advice
- Claim to be Medicare/Medicaid/government/pharmacy
- Collect SSN, credit card, banking info
- Promise specific meds are free

# DATA TO CAPTURE
first_name, takes_medications (yes/no), us_resident (yes/no), age_18_plus (yes/no), coverage_type, interested (yes/no), outcome (TRANSFERRED/NI/DNC/CALLBACK/NO_ANSWER)`;

const ENVS = {
  VAPI_PRIVATE_KEY,
  VAPI_ASSISTANT_ID,
  VAPI_PHONE_NUMBER_ID,
  COMPANY_NAME:        'SeniorCare',
  VERIFIER_NUMBER,
  LLM_PROVIDER:        'openai',
  LLM_MODEL:           'gpt-4o',
  VAPI_VOICE_PROVIDER: 'vapi',
  VAPI_VOICE_ID:       'Savannah',
  VAPI_VOICE_SPEED:    '1.0',
  STT_PROVIDER:        'deepgram',
  STT_MODEL:           'nova-2',
  SERVER_URL,
  SERVER_SECRET:       'sc-webhook-2026',
  CONTROL_ADMIN_TOKEN: 'sc-admin-2026',
  SYSTEM_PROMPT,
};

// ── Vercel API helpers ────────────────────────────────────────────────────
function vercelRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.vercel.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function upsertEnv(key, value) {
  await vercelRequest('DELETE',
    `/v9/projects/${VERCEL_PROJECT_ID}/env?key=${encodeURIComponent(key)}`);
  const r = await vercelRequest('POST',
    `/v10/projects/${VERCEL_PROJECT_ID}/env`,
    { key, value, type: 'encrypted', target: ['production', 'preview', 'development'] });
  const ok = r.status === 200 || r.status === 201;
  console.log(`  ${ok ? '✔' : '✗'} ${key} (${r.status})${ok ? '' : ' — ' + JSON.stringify(r.body).slice(0,100)}`);
  return ok;
}

async function triggerRedeploy() {
  const r = await vercelRequest('GET', `/v6/deployments?projectId=${VERCEL_PROJECT_ID}&limit=1`);
  if (r.status !== 200 || !r.body.deployments?.length) {
    console.log('  Could not find latest deployment — redeploy manually in Vercel dashboard');
    return;
  }
  const latest = r.body.deployments[0];
  const rd = await vercelRequest('POST', '/v13/deployments', {
    name: 'vapi-control',
    deploymentId: latest.uid,
    target: 'production',
  });
  console.log(`  Redeploy triggered: ${rd.body?.url || rd.status}`);
}

async function main() {
  console.log('SeniorCare vapi-control — Vercel env var setup');
  console.log('===============================================');
  console.log(`Project: ${VERCEL_PROJECT_ID}\n`);

  if (VERIFIER_NUMBER === '+1XXXXXXXXXX') {
    console.warn('⚠  VERIFIER_NUMBER is placeholder — pass: VERIFIER_NUMBER=+1... node setup.js');
  }
  if (SERVER_URL.includes('YOUR_PROJECT')) {
    console.warn('⚠  SERVER_URL is placeholder — pass: SERVER_URL=https://your-app.vercel.app/vapi node setup.js');
  }

  let ok = 0;
  for (const [key, value] of Object.entries(ENVS)) {
    const success = await upsertEnv(key, String(value));
    if (success) ok++;
  }

  console.log(`\n${ok}/${Object.keys(ENVS).length} env vars set.`);
  console.log('\nTriggering Vercel redeploy...');
  await triggerRedeploy();

  console.log('\n✔ Done! Your Vercel deployment will pick up the new env vars.');
  const host = SERVER_URL.replace('https://','').split('/')[0];
  console.log(`  Test: https://${host}/health`);
  console.log('  Expected: {"ok":true,"assistantId":"37c1cb25-...","vercel":true}');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
