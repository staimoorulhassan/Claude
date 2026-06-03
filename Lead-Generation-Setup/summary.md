# AVR (Agent Voice Response) — Ecosystem Summary

> Researched from https://github.com/agentvoiceresponse and https://github.com/agentvoiceresponse/avr-docs
> (the org maintains 40+ repos). This is the "learn all its features" deliverable.

## What AVR is

**Agent Voice Response (AVR)** is an **open-source platform that turns a traditional phone/IVR system
into an AI-powered conversational voice agent**. It sits on top of **Asterisk** (the open-source PBX)
and streams live call audio to AI services, then streams the AI's spoken reply back to the caller.

Think of it as the **glue/orchestrator** between:

- **Telephony** (Asterisk / a SIP trunk / a dialer like ViciDial), and
- **AI providers** (Speech-to-Text, LLM, Text-to-Speech, or all-in-one Speech-to-Speech).

It is **MIT-licensed**, modular, and supports **50+ AI providers** through small, swappable connector
services. You can run it fully self-hosted or point it at cloud providers.

## The core idea: AudioSocket + modular connectors

1. **Asterisk** answers/originates the call and opens an **AudioSocket** TCP stream (raw audio).
2. **avr-core** receives that audio stream and orchestrates the pipeline:
   - sends caller audio to an **ASR/STT** connector → gets text,
   - sends text to an **LLM** connector → gets a reply,
   - sends reply text to a **TTS** connector → gets audio,
   - streams audio back to Asterisk → the caller hears it.
   - (Or, with an **STS** connector, it streams audio straight to a single speech-to-speech provider.)
3. Each connector is an **independent microservice** exposing a simple HTTP/WebSocket contract, so you
   can **swap providers without touching the core**.

```
Caller ⇄ Asterisk ⇄ AudioSocket ⇄ avr-core ⇄ ┌ ASR/STT connector ⇄ provider
                                              ├ LLM connector     ⇄ provider
                                              ├ TTS connector     ⇄ provider
                                              └ STS connector     ⇄ provider (all-in-one)
```

## Repository map (grouped by role)

### Core & infrastructure
| Repo | Purpose |
|------|---------|
| **avr-core** | The orchestrator. Bridges Asterisk AudioSocket ↔ ASR/LLM/TTS/STS connectors. |
| **avr-infra** | One-command launcher (docker-compose) for Core + ASR + LLM + TTS + Asterisk. |
| **avr-app** | Web **dashboard** (NestJS + SQLite backend, Next.js 16 / React 19 frontend) to design, train & orchestrate agents and manage Docker containers. JWT auth. |
| **avr-asterisk** | Lightweight Asterisk Docker image (the PBX). |
| **avr-ami** | Asterisk Management Interface integration (originate calls, monitor channels). |
| **avr-phone** | Phone/softphone integration module. |
| **avr-vad** | Voice Activity Detection (Silero VAD) — detects when the caller is speaking. |
| **avr-webhook** | Express.js service that receives webhook events from avr-core (call lifecycle, transcripts). |
| **avr-docs / avr-docs-mcp** | Documentation (Wiki.JS) and an MCP server for the docs. |

### ASR / Speech-to-Text connectors
`avr-asr-google-cloud-speech`, `avr-asr-soniox`, `avr-asr-sarvam` (Indic languages), …

### TTS / Text-to-Speech connectors
`avr-tts-google-speech-tts`, `avr-tts-elevenlabs`, `avr-tts-cartesia`, `avr-tts-soniox`,
`avr-tts-sarvam`, `avr-tts-coquitts`, `avr-tts-kokoro`, …

### LLM connectors
`avr-llm-openai`, `avr-llm-openai-assistant`, `avr-llm-openrouter`, `avr-llm-n8n` (workflow automation),
`avr-llm-typebot`, `avr-llm-sarvam`, …

### STS (Speech-to-Speech, all-in-one) connectors
`avr-sts-openai` (OpenAI Realtime), `avr-sts-gemini` (Gemini Live), `avr-sts-elevenlabs`,
`avr-sts-ultravox`, `avr-sts-xai` (Grok voice), `avr-sts-humeai`, `avr-sts-deepgram`,
`avr-sts-speechmatics` (Flow), …

> **Where Vapi fits:** Vapi is itself an all-in-one voice platform (STT+LLM+TTS+telephony). In AVR
> terms it plays the role of an **STS provider**. There is no official `avr-sts-vapi` connector yet, so
> we connect Vapi over **SIP** (see `docs/architecture.md`, Option A) — the lowest-config path — and
> keep AVR's connector pattern documented as the future-proof Option B.

## Key technical facts (for our build)

- **Requirements:** Node.js 18+, npm 9+, Docker Engine (mandatory for agent containers). Asterisk PBX
  is needed only for telephony.
- **avr-app** stores data in a **SQLite** DB under a `./data` volume; secured with a configurable
  `JWT_SECRET`. Backend on port **3001**, frontend on **3000** in dev.
- **avr-infra** is the fastest way to stand up the stack (`docker compose up`).
- Everything is **provider-swappable** — exactly what we exploit to make "change provider/voice from
  the Vapi API or a webhook" easy.

## avr-app — The Dashboard (full breakdown)

avr-app is a **NestJS + SQLite backend (port 3001) + Next.js 16 frontend (port 3000)** that manages
the entire stack from one UI. It is **not** in the audio path — it's the control plane.

**What it manages (backend modules):**
- `agents` — create/start/stop voice agents. Each agent is a set of Docker containers. Two modes:
  - **PIPELINE** (ASR → LLM → TTS, three containers) — maximum provider flexibility
  - **STS** (speech-to-speech, one container) — lowest latency, e.g. Vapi via SIP or OpenAI Realtime
- `providers` — provider configs. Each entry has `type` (ASR/LLM/TTS/STS), `name`, and a flexible
  `config` JSON (API keys, model names, endpoints). This is how you swap providers without code.
- `trunks` — SIP trunks: name, password, transport (udp/tcp/tls/wss), codecs (ulaw,alaw).
- `numbers` — inbound DIDs linked to agents (call routing).
- `phones` — avr-phone WebRTC softphone devices.
- `asterisk` — Asterisk AMI integration (call control / transfer).
- `docker` — manages Docker containers for connector services.
- `recordings` — call recording.
- `webhooks` — outbound webhook events (call lifecycle → your CRM / ViciDial).
- `users` / `auth` — JWT-based login.

**Agent Entity key fields:** `status` (RUNNING/STOPPED/ERROR/STARTING/STOPPING), `mode` (PIPELINE/STS),
`port`, `httpPort`, `providerAsr`, `providerLlm`, `providerTts`, `providerSts`, `numbers[]`.

**For our campaign:** create an agent in **STS mode** (Vapi as the STS provider) or **PIPELINE mode**
(self-hosted ASR/LLM/TTS). Add your providers in the dashboard, start the agent, link your DID/SIP
number, set a webhook to `vapi-control` for lead capture.

See `docs/avr-app-deep-dive.md` for the full entity schema and workflow.

---

## How this maps to our pharmacy lead-gen campaign

| Campaign need | AVR / Vapi piece |
|---------------|------------------|
| Dial leads at scale | **ViciDial** (Asterisk-based predictive dialer) |
| Talk to the lead naturally | **Vapi** assistant (acts as AVR's STS provider) with **Savannah** voice |
| Qualify the lead (script + logic) | LLM behind Vapi, driven by `ai-agent/prompt.md` |
| Hand eligible lead to USA verifier | **Vapi `transferCall`** → warm / 3-way transfer |
| Swap providers/voices later | AVR connector pattern + our `vapi-control` service |
| Dashboard / monitoring | **avr-app** dashboard + **avr-webhook** events |

See **`docs/architecture.md`** for the full wiring and **`docs/call-flow-flowchart.md`** for diagrams.
