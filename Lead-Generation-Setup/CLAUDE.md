# CLAUDE.md — Project guide for this Lead-Generation Setup

This file orients Claude Code (and any developer) working in this folder. Read `summary.md` first for
the AVR background, then this file for how *our* project is organized and the rules to follow.

## What this project is

An AI voice agent for a **pharmacy free-medicine-delivery lead-generation campaign**. Outbound calls
are placed by **ViciDial**; the conversation is handled by a **Vapi** assistant (voice "Savannah");
eligible leads are **3-way / warm-transferred to a USA verifier**. The design rides on **AVR (Agent
Voice Response)** patterns so STT/LLM/TTS/voice providers stay swappable.

## Architecture in one paragraph

`ViciDial (dialer) → SIP trunk → Vapi assistant (STT+LLM+TTS) → on qualification, transferCall → 3-way
bridge → USA verifier`. AVR is the orchestration/abstraction layer; Vapi is plugged in as AVR's
all-in-one "STS" provider. Two integration options exist — **Option A: direct SIP** (recommended, least
config) and **Option B: AVR-orchestrated connector**. See `docs/architecture.md`.

## Folder map

- `ai-agent/prompt.md` — the **single source of truth** for the agent's behavior/script. Edit here.
- `ai-agent/assistant.vapi.json` — Vapi assistant config consumed by the control service. The prompt
  text in it should mirror `prompt.md` (keep them in sync).
- `config/.env.example` — every tunable. Copy to `config/.env` (gitignored) for real values.
- `config/providers.example.json` — catalog of swappable LLM/STT/TTS/voice options.
- `services/vapi-control/` — Node/Express service: creates/updates the Vapi assistant, exposes a webhook
  to hot-swap provider/voice, and (Option B) acts as the Vapi server-url endpoint.
- `vicidial/` — ViciDial carrier + transfer config templates.
- `docs/` — architecture, flowcharts, Vapi setup, ViciDial setup.

## Conventions & rules

- **Never commit secrets.** Real keys go in `config/.env` (gitignored). Only `*.example` files are
  tracked. Vapi private key, ViciDial API creds, and SIP passwords are secrets.
- **Keep the prompt in two places in sync.** `ai-agent/prompt.md` is canonical; when you change it,
  regenerate/update `ai-agent/assistant.vapi.json`'s `model.messages[0].content`.
- **Provider/voice changes go through config**, not hardcoding. Use env vars + `providers.example.json`
  + the `vapi-control` service so swaps need no code edits.
- **Compliance matters.** This is outbound healthcare-adjacent telemarketing. Keep the disclosure,
  consent, opt-out (DNC), and "we do not provide medical advice" lines in the prompt. Do not remove them.
- **Voice = Savannah, provider = vapi.** Speed is configurable via `VAPI_VOICE_SPEED` (see env file
  notes about the speed scale).

## Common tasks

| Task | Where |
|------|-------|
| Change the sales script | `ai-agent/prompt.md` (then sync `assistant.vapi.json`) |
| Swap LLM (e.g. GPT-4o → Claude) | `config/.env` `LLM_PROVIDER`/`LLM_MODEL` → POST `/swap` on vapi-control |
| Change the voice or speed | `config/.env` `VAPI_VOICE_ID`/`VAPI_VOICE_SPEED` → `/swap` |
| Change the verifier transfer number | `config/.env` `VERIFIER_NUMBER` (used by transferCall) |
| Connect ViciDial → Vapi | `docs/vicidial-setup.md` + `vicidial/carrier-and-transfer.md` |
| Push assistant to Vapi | `cd services/vapi-control && npm i && npm run deploy` |

## Build / run (vapi-control service)

```bash
cd services/vapi-control
cp ../../config/.env.example ../../config/.env   # then fill it in
npm install
npm run deploy      # create/update the Vapi assistant from assistant.vapi.json
npm start           # run the webhook/control server (provider swap + Vapi server-url)
```

> There are no automated tests yet. If you add logic to `vapi-control`, add tests and a `npm test`
> script, and document them here.
