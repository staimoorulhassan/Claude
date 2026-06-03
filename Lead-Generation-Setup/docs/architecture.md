# Architecture

## Goal

Outbound pharmacy free-medicine-delivery lead generation. **ViciDial** dials leads; a **Vapi** voice
agent ("Savannah") qualifies them; eligible/interested leads are **3-way / warm-transferred to a USA
verifier**. We generate the lead and hand off the live call.

## The four building blocks

1. **ViciDial** — open-source predictive dialer (a wrapper around **Asterisk**). Loads lead lists,
   dials at scale, manages dispositions, and performs transfers/3-way conferences.
2. **Vapi** — all-in-one voice AI platform. Runs **STT + LLM + TTS** and the conversation. In **AVR**
   terms it plays the role of an **STS (speech-to-speech) provider**.
3. **AVR (Agent Voice Response)** — the open-source orchestration layer / abstraction so providers and
   voices stay swappable, plus a dashboard (`avr-app`) and webhook (`avr-webhook`). See `summary.md`.
4. **USA Verifier** — a human team (their own phones/queue) that receives transferred eligible leads.

---

## Option A — Direct SIP (recommended: least configuration) ✅

ViciDial talks to Vapi directly over a **BYO SIP trunk**. Vapi is the brain. AVR is optional here
(used for the dashboard/monitoring and as the swap-ready abstraction, not in the audio path).

```
                         answered call audio (RTP/SIP)
Lead  ◀──PSTN──▶  ViciDial / Asterisk  ◀════ SIP trunk ════▶  Vapi Assistant (Savannah)
                        │                                        │  STT + LLM + TTS
                        │ dispositions/API                       │
                        ▼                                        ▼  transferCall (warm/3-way)
                   ViciDial DB ◀── webhook ── vapi-control ◀─────┘
                                                                  │
                                                                  ▼
                                                          USA Verifier (number)
```

- **Pros:** fewest moving parts, lowest latency, fastest to launch, Vapi handles media + transfer.
- **Cons:** you rely on Vapi for telephony bridging; warm-transfer-with-summary is most reliable on
  Twilio-backed numbers (see `docs/vapi-setup.md`).
- **You configure:** a Vapi `byo-sip-trunk` credential, a ViciDial carrier pointing at the Vapi SIP
  URI, and the `transferCall` tool target = verifier number.

## Option B — AVR-orchestrated connector

ViciDial/Asterisk streams audio into **avr-core** via **AudioSocket**; avr-core routes to a Vapi
connector (acting as an STS provider). This gives you full provider abstraction in the media path.

```
Lead ◀─PSTN─▶ ViciDial/Asterisk ─AudioSocket─▶ avr-core ─▶ avr-sts-vapi connector ─▶ Vapi
                                                  │  (swap ASR/LLM/TTS/STS freely)
                                                  ▼
                                           avr-app dashboard + avr-webhook
```

- **Pros:** maximum control; swap to self-hosted STT/LLM/TTS without touching telephony; single
  dashboard; future-proof.
- **Cons:** more services to run (Docker), more config; **no official `avr-sts-vapi` connector exists
  yet** — you'd adapt an existing STS connector (e.g. fork `avr-sts-openai`) to speak to Vapi, or keep
  Vapi only for Option A and use native AVR connectors (OpenAI/Deepgram/ElevenLabs) instead of Vapi.

> **Recommendation:** Launch on **Option A**. Keep the AVR connector pattern (this repo's swap-ready
> config + `vapi-control`) so you can migrate to Option B later without redoing the campaign logic.

---

## Component responsibilities

| Concern | Owner | Notes |
|---------|-------|-------|
| Dial leads, pacing, DNC list, dispositions | ViciDial | Campaign `PHARMA01` |
| Bridge answered call to the agent | ViciDial carrier → Vapi SIP | Option A |
| Conversation (STT/LLM/TTS) | Vapi assistant | "Savannah" voice, swappable |
| Qualification logic / script | LLM via `ai-agent/prompt.md` | Edit prompt, not code |
| Transfer eligible lead | Vapi `transferCall` | Warm/3-way to verifier number |
| Capture lead + push disposition | `vapi-control` `/vapi` webhook | Wire to CRM + ViciDial API |
| Swap provider/voice/speed | `config/.env` + `vapi-control` `/swap` | API or webhook driven |
| Monitoring / dashboard | avr-app + avr-webhook (optional) | Or Vapi dashboard |

## Data / call lifecycle

1. ViciDial dials a lead from list, detects answer (AMD optional).
2. Call is bridged over SIP to the Vapi assistant.
3. Savannah delivers the disclosure + qualification questions (see prompt).
4. **Opt-out** at any time → mark DNC, end. **Not eligible** → polite close, NI.
5. **Eligible + interested** → `transferCall` warm/3-way → verifier joins → agent drops.
6. `end-of-call-report` webhook → store lead + outcome, push disposition to ViciDial.

See `docs/call-flow-flowchart.md` for the visual flow you asked about.
