# AVR Core Components — avr-asterisk, avr-ami, avr-phone

These three repos form the **telephony control layer** that makes our campaign more reliable than
relying on Vapi's Twilio-dependent warm-transfer alone. Together they give us:

- A self-hosted PBX (**avr-asterisk**)
- A REST/AMI bridge so the agent can trigger Asterisk-level transfers (**avr-ami**)
- A browser softphone for the USA verifier (**avr-phone**)

---

## 1. avr-asterisk — The PBX

**Source:** https://github.com/agentvoiceresponse/avr-asterisk

Asterisk **23.1.0** on Ubuntu 22.04, Docker-ready, PJSIP-based.

### Ports
| Port | Protocol | Purpose |
|------|----------|---------|
| 5060 | UDP | SIP signaling |
| 5038 | TCP | AMI (Asterisk Manager Interface) |
| 8088 | TCP | HTTP / ARI (Asterisk REST Interface) |
| 10000-20000 | UDP | RTP media |

### Config files (volume-mounted from host)
- `pjsip.conf` — endpoints, auth, AOR for SIP phones/trunks
- `extensions.conf` — dialplan (call routing, AudioSocket invocation)
- `manager.conf` — AMI credentials (avr-ami connects here)
- `queues.conf` — call queues (optional)
- `ari.conf` — ARI credentials (optional)

### Minimal docker-compose (avr-asterisk alone)
```yaml
services:
  asterisk:
    image: agentvoiceresponse/avr-asterisk:latest
    ports:
      - "5060:5060/udp"       # SIP
      - "5038:5038"           # AMI
      - "8088:8088"           # HTTP/ARI
      - "10000-20000:10000-20000/udp"   # RTP
    volumes:
      - ./asterisk-config:/etc/asterisk
    environment:
      TZ: America/New_York
```

### Key dialplan pattern (AudioSocket + UUID for avr-ami)
```ini
; extensions.conf
[avr-calls]
exten => avr,1,Set(CALL_UUID=${UNIQUEID})
exten => avr,n,AGI(agi://avr-core:4573/${CALL_UUID})   ; avr-core receives audio
exten => avr,n,Hangup()
```
> The UUID (`UNIQUEID`) is set **before** the AudioSocket/AGI is invoked. avr-ami uses this UUID
> to address the correct channel when triggering transfers or hangups.

### For ViciDial users
ViciDial ships its own Asterisk. In **Option A (direct SIP)**, `avr-asterisk` is not needed.
In **Option B/C** (self-hosted with avr-ami), you either:
- Use `avr-asterisk` as a **second Asterisk** (SIP B2BUA in front of ViciDial), or
- Point `avr-ami` at **ViciDial's Asterisk** (just change `AMI_HOST` to the ViciDial server IP).

---

## 2. avr-ami — The Call Control Bridge (★ most important for transfers)

**Source:** https://github.com/agentvoiceresponse/avr-ami

A **Node.js REST service** that translates HTTP calls into **Asterisk AMI actions**. The AI agent
(LLM or webhook) calls this service to transfer, hang up, or originate calls — no Asterisk dialplan
hacking needed.

### Why this matters for our campaign
Vapi's `warm-transfer-with-summary` is Twilio-dependent. If your verifier line is raw SIP and the
summary doesn't play, use **avr-ami** to do the transfer at the Asterisk layer — fully reliable,
provider-independent.

### Environment variables
```env
PORT=6006
AMI_HOST=127.0.0.1       # or your ViciDial Asterisk IP
AMI_PORT=5038
AMI_USERNAME=avr
AMI_PASSWORD=avr          # must match manager.conf
```

### REST API (all POST, JSON body)

#### `POST /transfer` — Route a live call to the verifier extension
```json
// Request
{ "uuid": "<CALL_UUID>", "extension": "<verifier_ext>", "context": "verifier-transfer", "priority": 1 }
// Response: { "success": true }
```

#### `POST /hangup` — End a call
```json
// Request
{ "uuid": "<CALL_UUID>" }
// Response: { "success": true }
```

#### `POST /originate` — Place an outbound call (alternative to ViciDial origination)
```json
// Request
{
  "channel": "PJSIP/leadphone@outbound-trunk",
  "extension": "avr",
  "context": "avr-calls",
  "priority": 1
}
// Response: { "success": true }
```

### Docker run
```bash
docker run -d --name avr-ami \
  -e PORT=6006 -e AMI_HOST=<asterisk-ip> -e AMI_PORT=5038 \
  -e AMI_USERNAME=avr -e AMI_PASSWORD=avr \
  -p 6006:6006 \
  agentvoiceresponse/avr-ami:latest
```

### How it fits in the call flow
```
Vapi agent qualifies lead
  → vapi-control /vapi webhook receives end-of-call or transfer event
    → calls POST http://avr-ami:6006/transfer { uuid, extension, context }
      → avr-ami → AMI action → Asterisk bridges lead + verifier
```

### manager.conf entry (on the Asterisk host)
```ini
[avr]
secret=avr                   ; change in production!
permit=0.0.0.0/0.0.0.0
read=all
write=all
```

---

## 3. avr-phone — Browser Softphone for the Verifier

**Source:** https://github.com/agentvoiceresponse/avr-phone

A **Progressive Web App (PWA)** browser-based SIP/WebRTC softphone. Your **USA verifier** opens this
in any browser to receive inbound transferred leads — no physical phone, no SIP client install.

### What it provides
- Web-based SIP/WebRTC phone UI
- Light + dark themes
- Multi-language support
- Service worker (works offline / installable as PWA)
- Avatars, wallpapers, custom icons

### How the verifier uses it
1. Host `avr-phone` (Docker or any static server) at e.g. `https://verifier.yourcompany.com`.
2. Verifier opens URL in Chrome/Firefox → installs as PWA (optional).
3. When Asterisk transfers the qualified lead, Asterisk dials the verifier's `avr-phone` PJSIP
   extension → the browser rings → verifier answers → 3-way complete.
4. No VoIP subscription, no hardware, works from any US location.

### Docker run
```bash
docker run -d --name avr-phone -p 3002:80 agentvoiceresponse/avr-phone:latest
```
> You'll need to configure the PJSIP WebSocket transport in `pjsip.conf` and point the browser
> phone at your Asterisk WebSocket URL (typically `wss://asterisk:8088/ws`).

---

## 4. Full Option C: AVR-native stack + Vapi (no Twilio dependency)

This is the **most self-contained** option and the **most reliable for 3-way transfers**:

```
                  ┌─────────────────────────────────────────────────────┐
                  │          avr-asterisk (PBX)                          │
  Lead ──PSTN──▶  │  Asterisk 23.1.0 / PJSIP                            │
                  │  - CALL_UUID assigned in dialplan                    │
                  │  - AudioSocket bridges to Vapi (SIP trunk → Vapi)   │
                  │  - Verifier endpoint = avr-phone (browser softphone) │
                  └─────────────┬───────────────────────────────────────┘
                                │ AMI (port 5038)
                          avr-ami:6006
                                │ POST /transfer
                       vapi-control /vapi webhook
                                │
                         Vapi assistant (Savannah)
                         STT + LLM + TTS
                         Qualifies lead → fires transfer event
```

**Transfer flow (no Twilio needed):**
1. Vapi's `end-of-call-report` (or a custom `tool-call` result) fires to `vapi-control`.
2. `vapi-control` calls `POST avr-ami:6006/transfer` with the call UUID and the verifier extension.
3. avr-ami sends the AMI `Redirect` action → Asterisk bridges the lead to the verifier's extension.
4. Verifier's `avr-phone` browser rings → they answer → 3-way complete.
5. Disposition written back to ViciDial (or your CRM) via ViciDial API.

**Transfer trigger options (pick one):**
- Vapi `transferCall` tool (easy, Twilio-best) — leave it in the assistant
- Vapi `server-url` tool call → `vapi-control` → `avr-ami` transfer (reliable on any SIP)
- avr-ami `/originate` instead of ViciDial (full replacement of ViciDial origination for small scale)

---

## Combined docker-compose (Option C full stack)
```yaml
# Lead-Generation-Setup/docker-compose.yml
services:
  asterisk:
    image: agentvoiceresponse/avr-asterisk:latest
    ports:
      - "5060:5060/udp"
      - "5038:5038"
      - "8088:8088"
      - "10000-20000:10000-20000/udp"
    volumes:
      - ./asterisk-config:/etc/asterisk
    environment:
      TZ: America/New_York

  avr-ami:
    image: agentvoiceresponse/avr-ami:latest
    ports:
      - "6006:6006"
    environment:
      PORT: 6006
      AMI_HOST: asterisk          # service name = hostname inside compose network
      AMI_PORT: 5038
      AMI_USERNAME: avr
      AMI_PASSWORD: "${AMI_PASSWORD}"    # from .env
    depends_on:
      - asterisk

  avr-phone:
    image: agentvoiceresponse/avr-phone:latest
    ports:
      - "3002:80"                 # verifier opens http://your-host:3002

  vapi-control:
    build: ./services/vapi-control
    ports:
      - "8080:8080"
    env_file:
      - ./config/.env
    environment:
      AVR_AMI_URL: "http://avr-ami:6006"   # vapi-control can call avr-ami directly
    depends_on:
      - avr-ami
```

> Add `AMI_PASSWORD` to `config/.env`. Keep `asterisk-config/manager.conf` in sync with that value.
