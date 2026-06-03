# Lead Generation Setup — Pharmacy Free Medicine Delivery Campaign

A complete blueprint + working scaffold for an **AI voice agent** that:

1. Is dialed out to leads by **ViciDial** (predictive/outbound dialer).
2. Runs the conversation with **Vapi** as the brain (STT + LLM + TTS + voice agent).
3. Qualifies callers for a **pharmacy free-medicine-delivery** offer.
4. **3-way / warm transfers eligible leads to a USA verifier** — we only generate the lead and hand the live call over.
5. Is built on top of **AVR (Agent Voice Response)** concepts so providers and voices stay swappable.

> **Note on where this lives.** This kit was generated in a cloud container and pushed to your
> Git branch, because the assistant cannot write to your Windows Desktop. To get it onto your
> machine exactly where you wanted it:
> ```
> git clone <repo>            # or: git pull
> # copy the Lead-Generation-Setup folder onto your Desktop
> ```
> The `ai-agent/` folder is the equivalent of your intended `Downloads/personal-ai-agent`.

---

## What's inside

```
Lead-Generation-Setup/
├── README.md                     ← you are here
├── summary.md                    ← AVR ecosystem: every repo + feature, explained
├── CLAUDE.md                     ← project guide for Claude Code / future devs
├── ai-agent/
│   ├── prompt.md                 ← the pharmacy lead-gen agent system prompt
│   └── assistant.vapi.json       ← Vapi assistant config (Savannah voice, swappable)
├── config/
│   ├── .env.example              ← every swappable setting (provider, voice, speed, SIP, Vici)
│   └── providers.example.json    ← catalog of swappable LLM / STT / TTS / voice options
├── services/
│   └── vapi-control/             ← Node service + webhook to create/update assistants & swap providers
├── vicidial/
│   └── carrier-and-transfer.md   ← ViciDial SIP trunk + 3-way transfer config templates
└── docs/
    ├── architecture.md           ← full system design + the two integration options
    ├── call-flow-flowchart.md    ← Mermaid flowcharts you can render/edit
    ├── vapi-setup.md             ← Vapi: providers, voices, speed, SIP trunk, transfers
    └── vicidial-setup.md         ← ViciDial: connect to Vapi via SIP or API, 3-way transfer
```

## The 5-minute mental model

```
ViciDial dials a lead ──SIP──▶ Vapi assistant ("Savannah") talks to the lead
                                      │
                                      ├─ not eligible → polite close, dispo = NI
                                      │
                                      └─ eligible → transferCall → 3-way bridge ──▶ USA Verifier
                                                                   (we stay/drop, verifier takes over)
```

## Where to start

1. Read **`summary.md`** to understand AVR and the building blocks.
2. Read **`docs/architecture.md`** and pick **Option A (direct SIP)** or **Option B (AVR-orchestrated)**.
3. Copy **`config/.env.example` → `.env`** and fill in your Vapi + ViciDial values.
4. Use **`services/vapi-control`** to push the assistant from **`ai-agent/assistant.vapi.json`** to Vapi.
5. Wire **ViciDial** using **`docs/vicidial-setup.md`** + **`vicidial/carrier-and-transfer.md`**.
6. Tune the script in **`ai-agent/prompt.md`** for your exact offer/compliance language.
