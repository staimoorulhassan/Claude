# Call-Flow Flowcharts

You asked for something to guide the flow design. These are **Mermaid** diagrams — they render
automatically on GitHub, and you can edit/export them at <https://mermaid.live> (paste the code,
then download PNG/SVG). For a drag-and-drop canvas, [draw.io](https://draw.io) can import Mermaid too.

---

## 1) High-level system

```mermaid
flowchart LR
    Lead([Lead / Customer]) <-->|PSTN| VD[ViciDial / Asterisk\nPredictive Dialer]
    VD <-->|SIP trunk| VAPI[Vapi Assistant\n'Savannah' STT+LLM+TTS]
    VAPI -->|transferCall warm/3-way| VER([USA Verifier])
    VAPI -->|webhook events| CTRL[vapi-control\nlead capture + swap]
    CTRL -->|disposition / API| VD
    CTRL -.optional.-> AVR[AVR dashboard\navr-app / avr-webhook]
```

---

## 2) Conversation & qualification logic (the campaign brain)

```mermaid
flowchart TD
    A[Call answered & bridged to Savannah] --> B[Disclosure: recorded line + brand name]
    B --> C{Opt-out / 'do not call' / hostile?}
    C -- yes --> DNC[Apologize, add to DNC, end call\nDISPO = DNC]
    C -- no --> Q1{Q1: Takes prescription meds?}
    Q1 -- no & not interested --> NI[Polite close\nDISPO = NI]
    Q1 -- yes --> Q2{Q2: US resident?}
    Q2 -- no --> NI
    Q2 -- yes --> Q3{Q3: 18 or older?}
    Q3 -- no --> NI
    Q3 -- yes --> Q4[Q4: Capture coverage type\ninsured/medicare/medicaid/uninsured]
    Q4 --> Q5{Q5: Interested in free/low-cost delivery?}
    Q5 -- no --> NI
    Q5 -- yes --> ELIG[ELIGIBLE LEAD]
    ELIG --> T[Say hold message + transferCall to verifier]
    T --> TR{Verifier available?}
    TR -- yes --> WARM[Warm/3-way bridge\nsummary passed\nagent drops\nDISPO = TRANSFERRED]
    TR -- no --> CB[Promise callback, end\nDISPO = CALLBACK]
```

---

## 3) The 3-way / warm transfer detail

```mermaid
sequenceDiagram
    participant L as Lead
    participant S as Savannah (Vapi)
    participant V as USA Verifier
    L->>S: Qualifies & agrees
    S->>L: "Please hold, connecting a specialist..."
    S->>V: Dial verifier (transferCall)
    Note over S,V: warm-transfer-with-summary:<br/>verifier hears a 1-2 sentence summary first
    V-->>S: Verifier picks up
    S->>L: Bridge lead + verifier (3-way)
    Note over S: Agent drops off the bridge
    V->>L: Verifier completes verification
```

---

## 4) Provider / voice swap path (ops view)

```mermaid
flowchart LR
    OPS[Operator] -->|edit| ENV[config/.env\nLLM/voice/speed/verifier]
    OPS -->|POST /swap or /deploy| CTRL[vapi-control]
    ENV --> CTRL
    CTRL -->|PATCH /assistant| VAPI[Vapi Assistant]
    subgraph Swappable
      LLM[LLM: gpt-4o / claude / llama]
      VOICE[Voice: Savannah / 11labs / cartesia]
      STT[STT: deepgram / assemblyai]
    end
    VAPI --- LLM
    VAPI --- VOICE
    VAPI --- STT
```

> Tip: keep this file open while you design. Change a node, paste into mermaid.live, export the image
> for your SOP/training docs.
