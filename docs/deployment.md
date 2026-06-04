# Deployment — Chosen Path: Direct to Vapi

> **Decision (locked in):** The hub's audio does NOT run on a self-hosted Asterisk.
> The client PC is on IPv6/CGNAT with no public IPv4, so the IPv4 ViciDial server
> cannot dial into it. Instead, ViciDial connects straight to Vapi's SIP, and the
> **Lead Generation Hub runs serverless on Vercel** as the orchestration brain.

---

## Active architecture

```
ViciDial AIOUT (46.225.136.17)
  │  dials lead, bridges answered call
  ▼
sip.vapi.ai   ← carrier VAPI-SeniorCare Account Entry (already set ✓)
  │  Savannah: STT (Deepgram) + LLM (GPT-4o) + TTS (Savannah voice)
  ▼
Vapi webhooks ──► Hub Control API (Vercel)  ← the "brain"
  │                  • captures every lead → leads store
  │                  • on qualify: returns huclose DID as transfer target
  ▼
Vapi transferCall ──► huclose closer-queue DID
  │  ViciDial receives inbound → rings verifier agent
  ▼
Lead ↔ Verifier connected. Savannah drops off. ViciDial holds the bridge.
```

The hub still "guides everything" — it just orchestrates via **webhooks + API**
rather than carrying the audio. No PC, no VPS, no CGNAT/IPv6 problem.

---

## Why the full AVR Docker stack is NOT used here

The `docker-compose.yml` + `asterisk/` configs in this repo describe the *full*
self-hosted hub (avr-asterisk → avr-core → avr-ami). That path requires a host
with a **public IPv4** that ViciDial can reach. Keep it for later if you move to
a **VPS** (see `docs/run-on-your-pc.md` steps, but on a VPS IP instead of a PC).
For now it stays dormant.

---

## What carries each responsibility (direct path)

| Responsibility | Handled by |
|---|---|
| Dial leads | ViciDial AIOUT (predictive 1:1) |
| Carry call audio to AI | ViciDial → sip.vapi.ai (SIP) |
| STT + LLM + TTS (Savannah) | Vapi |
| Decide eligibility / when to transfer | Vapi assistant (SeniorCare prompt) |
| Capture lead data | Hub Control API on Vercel → leads store |
| Provide transfer target | Hub returns huclose DID on `transfer-destination-request` |
| Execute 3-way to verifier | Vapi `transferCall` → huclose DID → ViciDial inbound |
| Hold lead ↔ verifier bridge | ViciDial |
| No recordings (privacy) | Vapi `recordingEnabled:false`, artifactPlan off |

---

## Remaining to go live (only 2 values)

| # | Value | Where to get it |
|---|---|---|
| 1 | **VERIFIER_NUMBER** = `+12233445562` | ✅ confirmed — huclose closer-queue DID |
| 2 | **SERVER_URL** = `https://claude-13eemnod8-taimors-projects-18132fe2.vercel.app/vapi` | ✅ confirmed — Vercel deployment |

Then:
1. Run `setup.js` locally (pushes env vars to Vercel), OR set them in the Vercel UI.
2. In **Vapi dashboard → Assistant 37c1cb25 → Server URL** = your Vercel `/vapi`.
3. In **Vapi → Assistant → Tools → transferCall**, destination = `VERIFIER_NUMBER`
   (huclose DID). Mode: warm-transfer-with-summary.
4. ViciDial: ensure huclose DID exists and routes to the closer in-group.
5. Activate AIOUT list 100001 + hopper → test call.

---

## ViciDial carrier — confirmed correct for this path

```ini
[vapi-trunk]
type=peer
host=sip.vapi.ai          ; ✓ correct for direct path — do NOT change
insecure=port,invite
qualify=yes
nat=force_rport,comedia
context=vapi-inbound
```

> If Vapi requires SIP auth for inbound from ViciDial, create a **BYO SIP trunk
> credential** in Vapi (origination IP = 46.225.136.17) and/or add
> `username=`/`secret=` here. If Vapi accepts the call by IP, the block above is
> enough.
