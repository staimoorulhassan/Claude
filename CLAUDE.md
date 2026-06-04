# Lead Generation Setup — Developer Guide

## What this is

A complete outbound lead-generation system for pharmacy free-medication delivery (brand: SeniorCare).

**Three components, one hub:**
- **ViciDial** — autodialer + 3-way conference (dials leads, rings verifiers)
- **Lead Generation Hub (AVR)** — the brain (orchestrates everything)
- **Vapi** — voice AI only (Savannah: STT + LLM + TTS, no telephony)

## Active deployment: Direct to Vapi

The client connection is IPv6/CGNAT (no public IPv4), so the self-hosted Asterisk
stack can't receive calls from ViciDial. **Active path** (see `docs/deployment.md`):

```
ViciDial dials lead → sip.vapi.ai (Savannah qualifies)
  → Vapi webhook → Hub Control API (Vercel) captures lead + returns huclose DID
    → Vapi transferCall → huclose DID → ViciDial rings verifier
      → lead ↔ verifier connected, Savannah drops off
```

The full AVR Docker stack below is the **VPS-only** alternative (dormant for now).

## Full-stack mental model (VPS option)

```
ViciDial dials lead
  → bridges call → avr-asterisk (SIP)
    → AudioSocket → avr-core
      → Vapi API (Savannah qualifies lead)
        → transfer signal → Hub Control API (Vercel)
          → avr-ami REST → ViciDial AMI (3-way dial verifier)
            → verifier answers → Savannah confirms → hub drops off
              → ViciDial holds lead ↔ verifier until they hang up
```

## Repo layout

```
/
├── docker-compose.yml          ← start everything: docker compose up -d
├── .env.example                ← copy to .env, fill in
├── asterisk/
│   ├── pjsip.conf              ← ViciDial SIP trunk
│   ├── extensions.conf         ← AudioSocket routing + UUID tracking
│   └── manager.conf            ← AMI credentials for avr-ami
├── vapi-control-vercel/        ← Hub Control API (runs on Vercel)
│   └── src/server.js           ← Vapi webhooks + transfer → avr-ami
├── docs/
│   ├── architecture.md         ← system diagram + full call flow table
│   ├── vicidial-integration.md ← ViciDial config details (confirmed env)
│   └── call-flow.md            ← step-by-step flow
├── setup.js                    ← run locally to push env vars to Vercel
└── vercel.json                 ← Vercel build config (vapi-control-vercel)
```

## Common tasks

| Task | Command / Where |
|---|---|
| Start full stack | `docker compose up -d` |
| View logs | `docker compose logs -f avr-core` |
| Stop stack | `docker compose down` |
| Push Vercel env vars | `VERCEL_TOKEN=... VAPI_PRIVATE_KEY=... VERIFIER_NUMBER=... SERVER_URL=... node setup.js` |
| Swap Vapi voice | `POST /swap` with Bearer `CONTROL_ADMIN_TOKEN` |
| View leads | `GET /leads` with Bearer `CONTROL_ADMIN_TOKEN` |
| Health check | `GET /health` on Vercel URL |

## Environment variables

See `.env.example` for the full list. Critical values:

| Variable | Description |
|---|---|
| `VAPI_PRIVATE_KEY` | Vapi API key |
| `VAPI_ASSISTANT_ID` | Savannah assistant ID |
| `VERIFIER_NUMBER` | Closer-queue DID (where qualified leads transfer) |
| `VICIDIAL_AMI_SECRET` | ViciDial manager.conf secret (needed for 3-way) |
| `SERVER_URL` | Vercel deployment URL + `/vapi` |
| `AVR_AMI_URL` | `http://avr-ami:3002` (Docker internal) |

## What still needs to be done

1. **VERIFIER_NUMBER** — get the closer-queue DID from ViciDial → Inbound → DIDs
2. **SERVER_URL** — get from Vercel dashboard → Deployments
3. **VICIDIAL_AMI_SECRET** — from ViciDial server `/etc/asterisk/manager.conf`
4. **Carrier Account Entry on ViciDial** — paste `[vapi-trunk]` block (see `docs/vicidial-integration.md`)
5. **avr-asterisk SIP** — ViciDial carrier must point to this server's public IP:5060
6. Run `node setup.js` to push env vars to Vercel

## Privacy

- Vapi recording: **DISABLED** (`recordingEnabled: false`, full `artifactPlan` off)
- Lead data: written to local `data/leads.jsonl` (gitignored) — never leaves your server
- No SSN, credit card, banking data ever collected
