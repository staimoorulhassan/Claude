# avr-app Deep Dive — Dashboard, Entities & Integration Guide

**Source:** https://github.com/agentvoiceresponse/avr-app

avr-app is the **admin dashboard + orchestrator** for the entire AVR stack. It stores configuration in
**SQLite**, manages provider Docker containers, wires agents to phone numbers/trunks, and exposes REST
APIs consumed by the frontend.

---

## Architecture

```
Browser ──HTTP──▶ Next.js 16 (port 3000)
                       │ API calls
                       ▼
                 NestJS 10 (port 3001)
                       │
                       ├─ TypeORM ──▶ SQLite (./data/db.sqlite)
                       ├─ Docker SDK ──▶ manages ASR/LLM/TTS/STS connector containers
                       └─ AMI client ──▶ Asterisk (via avr-ami or directly)
```

**Stack:** TypeScript 98%, NestJS + TypeORM backend, Next.js 16 + React 19 + Tailwind + shadcn/ui frontend.
**Auth:** JWT (`JWT_SECRET` env var). Login page at `/login`, all other routes protected.

---

## Backend modules (`backend/src/`)

| Module | What it manages |
|--------|----------------|
| **agents** | Voice agent lifecycle (create/start/stop/delete), Docker container per agent |
| **providers** | Provider configs (API keys, endpoints, settings stored as JSON) |
| **trunks** | SIP trunk definitions (name, password, transport, codecs) |
| **numbers** | Phone numbers linked to agents (inbound routing) |
| **phones** | avr-phone softphone device management |
| **asterisk** | Asterisk AMI integration (call control, channel events) |
| **docker** | Docker container management for connector services |
| **recordings** | Call recording storage + retrieval |
| **webhooks** | Outbound webhook configuration (call lifecycle events) |
| **provisioning** | Device/endpoint provisioning |
| **users** | User accounts |
| **auth** | JWT login / token refresh |

---

## Key Entities

### Agent
```typescript
{
  id: UUID                  // auto-generated
  name: string              // e.g. "Pharmacy Lead Qualifier"
  status: RUNNING | STOPPED | ERROR | STARTING | STOPPING   // default STOPPED
  mode: PIPELINE | STS      // PIPELINE = ASR→LLM→TTS  |  STS = speech-to-speech
  port: number | null       // AudioSocket port this agent listens on
  httpPort: number | null   // HTTP port for the connector
  lastError: string | null
  failureStatus: NONE | RETRYABLE | TERMINAL
  failureReason: NONE | DEPENDENCY_UNAVAILABLE | COMPENSATION_FAILED | CONFIGURATION_INVALID | UNKNOWN
  retryable: boolean | null
  // Many-to-One (eager):
  providerAsr: Provider | null   // PIPELINE mode ASR provider
  providerLlm: Provider | null   // PIPELINE mode LLM provider
  providerTts: Provider | null   // PIPELINE mode TTS provider
  providerSts: Provider | null   // STS mode speech-to-speech provider
  // One-to-Many:
  numbers: PhoneNumber[]   // phone numbers that route to this agent
}
```

> **PIPELINE mode** = Deepgram (ASR) → OpenAI (LLM) → ElevenLabs (TTS) — three separate connectors.
> **STS mode** = single speech-to-speech provider (OpenAI Realtime, Gemini Live, Vapi via SIP, etc.).

> **For our campaign:** use **STS mode** if routing via Vapi (one hop), or **PIPELINE mode** with
> individual AVR connectors if you want full self-hosted control.

### Provider
```typescript
{
  id: UUID
  type: ASR | LLM | TTS | STS      // which pipeline stage
  name: string                       // unique, e.g. "deepgram-nova2" or "openai-realtime"
  config: Record<string, any>        // flexible JSON: API keys, model names, endpoints, etc.
}
```

> The `config` JSON is provider-specific. e.g. for OpenAI LLM:
> `{ "apiKey": "sk-...", "model": "gpt-4o", "systemPrompt": "..." }`

### Trunk (SIP)
```typescript
{
  id: UUID
  name: string           // unique carrier/trunk name e.g. "vapi-sip-trunk"
  password: string       // SIP auth password
  transport: udp | tcp | tls | wss    // default udp
  codecs: string         // default "ulaw,alaw"
}
```

### PhoneNumber
Links an inbound DID/SIP number to an agent (so calls arriving on that number route to that agent's Docker container).

---

## Agent modes and our campaign

| Mode | Best for | Connectors started |
|------|----------|-------------------|
| **PIPELINE** | Full provider swap control (self-hosted or mix) | ASR container + LLM container + TTS container |
| **STS** | Vapi-as-brain via SIP, or OpenAI Realtime, Gemini Live | Single STS container |

For **Option A (ViciDial → Vapi SIP)**, avr-app in **STS mode** with a Vapi STS provider entry is
the cleanest. The `config` JSON for that provider would contain the Vapi SIP URI and assistant ID.

For **Option B/C (self-hosted pipeline)**, use **PIPELINE mode** with individual connectors.

---

## avr-app environment variables

### Backend (`backend/.env`)
```env
JWT_SECRET=your-long-random-secret
PORT=3001
# Docker socket path (needed for container management)
DOCKER_SOCKET=/var/run/docker.sock
```

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

## Running avr-app (quick start)

### With Docker (recommended)
```bash
docker run -d --name avr-app-backend \
  -e JWT_SECRET=changeme \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd)/data:/app/data \
  -p 3001:3001 \
  agentvoiceresponse/avr-app-backend:latest

docker run -d --name avr-app-frontend \
  -e NEXT_PUBLIC_API_URL=http://localhost:3001 \
  -p 3000:3000 \
  agentvoiceresponse/avr-app-frontend:latest
```

### Dev (no Docker)
```bash
# Backend
cd backend && npm install && cp .env.example .env && npm run start:dev

# Frontend (separate terminal)
cd frontend && npm install && cp .env.example .env.local && npm run dev
```
Then open http://localhost:3000 → login → configure providers → create agents.

---

## Workflow: setting up our campaign agent in avr-app

1. **Login** at http://localhost:3000.
2. **Providers** → Add ASR (e.g. `deepgram`, type=ASR, config=`{"apiKey":"...","model":"nova-2"}`).
3. **Providers** → Add LLM (e.g. `openai-gpt4o`, type=LLM, config=`{"apiKey":"...","model":"gpt-4o","systemPrompt":"<paste prompt.md>"`).
4. **Providers** → Add TTS (e.g. `vapi-savannah`, type=TTS or STS depending on mode).
5. **Trunks** → Add `vapi-sip-trunk` with transport=udp, codecs=ulaw,alaw.
6. **Agents** → Create `Pharmacy Lead Qualifier`, mode=PIPELINE or STS, select providers, Start.
7. **Numbers** → Link your ViciDial DID to this agent.
8. **Webhooks** → Point to your `vapi-control` `/vapi` endpoint for lead capture.

---

## How avr-app relates to our other components

```
avr-app dashboard
  ├─ configures providers → stored in SQLite
  ├─ starts Docker containers (avr-asr-deepgram, avr-llm-openai, avr-tts-elevenlabs, etc.)
  ├─ manages trunks → used by avr-asterisk for SIP routing
  ├─ manages phones → avr-phone WebRTC softphones for verifier
  ├─ triggers avr-ami → for reliable Asterisk-level transfers
  └─ receives webhooks → call lifecycle events → lead capture → ViciDial disposition
```
