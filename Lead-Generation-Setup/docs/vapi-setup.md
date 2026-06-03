# Vapi Setup — LLM, STT, TTS, Voice, SIP trunk & Transfer

Vapi is the **all-in-one brain**: it runs the transcriber (STT), the model (LLM), and the voice (TTS),
and it performs the **transfer** to the verifier. Everything below is swappable from `config/.env` +
the `vapi-control` service.

## 1) Account & keys
1. Create a Vapi account and grab your **private API key** → `VAPI_PRIVATE_KEY` in `config/.env`.
2. (Optional) add provider keys in Vapi if you BYO OpenAI/ElevenLabs/etc. keys.

## 2) The assistant (Savannah)
The assistant is defined in `ai-agent/assistant.vapi.json` (a template) and pushed by `vapi-control`:
```bash
cd services/vapi-control && npm install && npm run deploy
```
Key fields:
- **model** — `{ provider, model }` → the LLM. Default `openai/gpt-4o`. Swap via `LLM_PROVIDER`/`LLM_MODEL`.
- **transcriber** — `{ provider, model, language }` → STT. Default `deepgram/nova-2`.
- **voice** — `{ provider, voiceId, speed }`. Default `vapi` / **`Savannah`**.
- **server** — your `vapi-control` `/vapi` webhook URL + secret.
- **model.tools[0]** — the `transferCall` tool (see §5).

## 3) Voice: Savannah + speed
```json
"voice": { "provider": "vapi", "voiceId": "Savannah", "speed": 1.0 }
```
- `provider: "vapi"` uses Vapi's own voices; **`Savannah`** is the female voice you asked for.
- **Speed:** Vapi's voice `speed` is a **multiplier** (1.0 = normal; usable range roughly 0.5–2.0).
  Your "**speed 7**" is almost certainly a **dashboard slider** value, not the API number. Set the API
  multiplier in `VAPI_VOICE_SPEED` (start at 1.0, nudge up to ~1.15–1.3 for a brisker delivery) and
  confirm against the slider in your Vapi dashboard. Swap live:
  ```bash
  curl -X POST localhost:8080/swap -H "Authorization: Bearer $CONTROL_ADMIN_TOKEN" \
    -H 'Content-Type: application/json' -d '{"voice":{"provider":"vapi","voiceId":"Savannah","speed":1.2}}'
  ```
  > Note: only some providers (e.g. **PlayHT**) expose a dedicated `speed` field; others use
  > `experimentalControls.speed` (−1…1). For the `vapi` provider, use the numeric `speed` multiplier.

## 4) BYO SIP trunk (so ViciDial can reach Vapi) — Option A
1. In Vapi, create a **credential** of type **`byo-sip-trunk`** with your trunk details
   (gateways, optional auth). Note its **credential id** → `VAPI_SIP_TRUNK_CREDENTIAL_ID`.
2. Vapi gives you a SIP URI of the form **`sip:username@sip.vapi.ai`** → `VAPI_SIP_URI`.
   - **Outbound gateways** accept hostnames **or** IPv4. **Inbound gateways** accept **IPv4 only**.
   - **Whitelist all signaling IPs** when creating the trunk, or inbound calls get `401 Unauthorized`.
3. Attach the assistant to that inbound SIP route (Phone Number / SIP resource) so calls arriving on
   the URI are answered by Savannah.
4. In **ViciDial**, point a carrier/trunk at `VAPI_SIP_URI` (see `docs/vicidial-setup.md`).

## 5) Transfer to the USA verifier (`transferCall`)
Configured in the assistant tools (already in the template):
```json
{
  "type": "transferCall",
  "destinations": [{
    "type": "number",
    "number": "+1XXXXXXXXXX",
    "transferPlan": {
      "mode": "warm-transfer-with-summary",
      "summaryPlan": { "enabled": true, "messages": [ /* uses {{transcript}} */ ] }
    }
  }]
}
```
Transfer modes:
- **`blind`** — hand the call off immediately, no context. Lowest friction.
- **`warm-transfer-say-message`** — play a fixed message to the verifier, then bridge.
- **`warm-transfer-with-summary`** — Vapi speaks a 1–2 sentence **summary** of the lead to the verifier
  before bridging (what we use → effectively a 3-way handoff).

> **Important reliability note:** warm transfer (with summary) is most reliable on **Twilio-backed**
> telephony. On raw SIP/other providers the summary may not play unless the far end extracts SIP
> headers. If your verifier line is on a non-Twilio path and the summary doesn't play, fall back to
> `blind` or `warm-transfer-say-message`, or do the 3-way conference inside **ViciDial** instead
> (see `vicidial/carrier-and-transfer.md`). Set `VERIFIER_NUMBER` in `config/.env`.

## 6) Webhook (lead capture + dynamic transfer)
Set `SERVER_URL` to your public `vapi-control` `/vapi` endpoint and `SERVER_SECRET`. Vapi sends
`end-of-call-report` (store the lead, push disposition to ViciDial), `status-update`, and
`transfer-destination-request` (return a dynamic verifier number if you route to multiple verifiers).

## Sources
- Vapi Speech configuration — https://docs.vapi.ai/customization/speech-configuration
- Vapi Voices — https://docs.vapi.ai/providers/voice/vapi-voices
- Vapi SIP trunking — https://docs.vapi.ai/advanced/sip/sip-trunk
- Vapi Call forwarding / transfers — https://docs.vapi.ai/call-forwarding
- Assistant-based warm transfer — https://docs.vapi.ai/calls/assistant-based-warm-transfer
