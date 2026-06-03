# Lead Generation Setup — Architecture

## System roles (rebuilt)

| Component | Role | What it is NOT |
|---|---|---|
| **Lead Generation Setup (AVR)** | Central hub — orchestrates everything | just a webhook receiver |
| **Vapi** | STT + LLM + TTS + voice-AI only | the telephony layer |
| **ViciDial** | Autodialer + dialing hub + 3-way conference | just a SIP carrier |
| **avr-asterisk** | SIP bridge: ViciDial → AudioSocket | standalone PBX |
| **avr-core** | Voice pipeline: audio ↔ Vapi AI | replacement for ViciDial |
| **avr-ami** | AMI bridge: hub ↔ ViciDial Asterisk | direct dial logic |
| **avr-app** | Web dashboard + NestJS API | optional UI |

---

## Full call flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    LEAD GENERATION SETUP (Hub)                   │
│                                                                   │
│   ┌──────────┐   AudioSocket   ┌──────────┐                      │
│   │avr-aster-│◄───────────────►│ avr-core │                      │
│   │  isk     │                 │(pipeline)│                      │
│   │SIP :5060 │                 └────┬─────┘                      │
│   └────┬─────┘                      │ Vapi STS API               │
│        │ SIP                         │ (STT+LLM+TTS)             │
└────────┼────────────────────────────┼────────────────────────────┘
         │                            ▼
         │                    ┌───────────────┐
         │                    │     VAPI      │
         │                    │ (voice AI     │
         │                    │  Savannah)    │
         │                    └───────┬───────┘
         │                            │ webhook (transfer / end-of-call)
         │                    ┌───────▼───────┐
         │                    │  Hub Control  │
         │                    │  API (Vercel) │
         │                    └───────┬───────┘
         │                            │ REST → avr-ami
         │                    ┌───────▼───────┐
         │                    │   avr-ami     │
         │                    │ (AMI bridge)  │
         │                    └───────┬───────┘
         │                            │ AMI :5038
         ▼                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VICIDIAL  (46.225.136.17)                      │
│                                                                   │
│  Campaign AIOUT           Closer queue huclose                   │
│  ┌─────────────┐          ┌────────────────┐                     │
│  │ Predictive  │          │  Verifier      │                     │
│  │ Dialer      │          │  Agents        │                     │
│  └──────┬──────┘          └────────┬───────┘                     │
│         │ outbound dial             │ inbound (DID)               │
└─────────┼─────────────────────────┼───────────────────────────────┘
          │                          │
      ┌───▼──────────────────────────▼───┐
      │           LEADS / VERIFIERS       │
      │         (phone network)           │
      └───────────────────────────────────┘
```

---

## Step-by-step call flow

| Step | Who acts | What happens |
|---|---|---|
| 1 | ViciDial AIOUT | Predictive dialer dials lead from list 100001 |
| 2 | Lead | Picks up |
| 3 | ViciDial | Bridges answered call → SIP INVITE to avr-asterisk :5060 |
| 4 | avr-asterisk | Accepts call, assigns `CALL_UUID=${UNIQUEID}`, pipes audio to AudioSocket |
| 5 | avr-core | Receives audio stream, opens Vapi STS session (API key + assistant ID) |
| 6 | Vapi (Savannah) | Runs STT → LLM (GPT-4o, SeniorCare prompt) → TTS (Savannah voice) |
| 7 | Lead | Talks to Savannah, answers eligibility questions |
| 8a | Not eligible / DNC | Savannah closes politely, call ends. Lead data captured. |
| 8b | **Eligible + interested** | Savannah triggers `transferCall` tool |
| 9 | Vapi → Hub API | `transfer-destination-request` webhook fires to Vercel control API |
| 10 | Hub API → avr-ami | REST `POST /transfer` with `{uuid, extension: VERIFIER_NUMBER}` |
| 11 | avr-ami → ViciDial AMI | AMI `Originate` or `Redirect` → dials verifier into 3-way conference |
| 12 | ViciDial | Rings closer-queue DID → verifier agent answers |
| 13 | Savannah | Confirms to lead: "I'm connecting you with a specialist — please hold" |
| 14 | Hub | Drops the avr-asterisk leg (AMI Hangup on CALL_UUID channel) |
| 15 | ViciDial | Maintains lead ↔ verifier bridge until they hang up |
| 16 | Vapi | Sends `end-of-call-report` webhook → lead captured to JSONL |

---

## Services and ports

| Service | Container | Port(s) | Description |
|---|---|---|---|
| avr-asterisk | avr-asterisk | 5060 SIP, 5038 AMI, 10000-10100 RTP | SIP ↔ AudioSocket bridge |
| avr-core | avr-core | internal | Voice pipeline → Vapi |
| avr-app | avr-app-backend | 3001 | NestJS hub API |
| avr-app | avr-app-frontend | 3000 | Next.js dashboard |
| avr-ami | avr-ami | 3002 | AMI bridge (local + ViciDial) |
| avr-phone | avr-phone | 4000 | WebRTC softphone (optional verifier UI) |
| hub-control | Vercel | 443 | Vapi webhook + admin API |

---

## ViciDial configuration summary

| Item | Value |
|---|---|
| Telephony server | Telephony3 — 46.225.136.17 |
| Outbound campaign | AIOUT (RATIO 1:1, NEW leads, list 100001) |
| Carrier | VAPI-SeniorCare → SIP to avr-asterisk :5060 |
| Closer queue | huclose (closers + inbound/blended enabled) |
| AI agent extension | 9001 (webphone, AiAgebts group) |
| Transfer preset | PRESET_1 → AGENTDIRECT (manual fallback only) |

---

## Vapi configuration summary

| Setting | Value |
|---|---|
| Role | STT + LLM + TTS provider only |
| Assistant | Savannah / `37c1cb25-28c7-41b4-bdf0-dcea72331856` |
| Phone number | `bec20f66-2bc6-41fc-856f-c51779736e87` |
| Server URL | `https://YOUR-PROJECT.vercel.app/vapi` |
| Recording | **DISABLED** (recordingEnabled: false) |
| Artifact plan | All disabled (no transcripts stored on Vapi) |
