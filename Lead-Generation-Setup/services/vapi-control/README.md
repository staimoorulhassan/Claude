# vapi-control

Deploys the pharmacy lead-gen assistant to Vapi and lets you **hot-swap provider / voice / speed /
verifier** from the **Vapi API** or a **webhook** — no code edits, exactly as required.

## Setup
```bash
cd services/vapi-control
cp ../../config/.env.example ../../config/.env   # fill in VAPI_PRIVATE_KEY, COMPANY_NAME, etc.
npm install
```

## Deploy / update the assistant
```bash
npm run render      # dry run: prints the rendered assistant JSON (no API call)
npm run deploy      # creates the assistant (prints its id) or updates VAPI_ASSISTANT_ID
```
After the first create, copy the printed id into `config/.env` as `VAPI_ASSISTANT_ID`.

## Run the control + webhook server
```bash
npm start           # listens on CONTROL_PORT (default 8080)
```

### Endpoints
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | — | liveness |
| POST | `/deploy` | Bearer `CONTROL_ADMIN_TOKEN` | re-render from template + .env, update assistant |
| POST | `/swap` | Bearer `CONTROL_ADMIN_TOKEN` | hot-swap llm/voice/transcriber |
| POST | `/vapi` | `x-vapi-secret: SERVER_SECRET` | Vapi server-url webhook (leads, transfers) |

### Swap examples
```bash
# Change the voice speed on the fly
curl -X POST localhost:8080/swap -H "Authorization: Bearer $CONTROL_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"voice":{"provider":"vapi","voiceId":"Savannah","speed":1.25}}'

# Switch the LLM to Claude
curl -X POST localhost:8080/swap -H "Authorization: Bearer $CONTROL_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"llm":{"provider":"anthropic","model":"claude-sonnet-4-6"}}'

# Switch TTS to ElevenLabs
curl -X POST localhost:8080/swap -H "Authorization: Bearer $CONTROL_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"voice":{"provider":"11labs","voiceId":"<id>"}}'
```

The `/vapi` webhook receives `end-of-call-report`, `status-update`, and `transfer-destination-request`.
Wire your CRM + ViciDial disposition push inside the `end-of-call-report` case in `src/server.js`.

> In development, expose the server publicly (e.g. `ngrok http 8080`) and set `SERVER_URL` to that URL
> so Vapi can reach `/vapi`.
