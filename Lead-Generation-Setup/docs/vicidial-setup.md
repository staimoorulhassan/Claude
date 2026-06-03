# ViciDial Setup — Connect the Dialer to Vapi

ViciDial is an **Asterisk-based** open-source predictive dialer. It loads your lead lists, dials at
scale, and routes answered calls. We connect it to the Vapi assistant and let Vapi (or ViciDial)
perform the verifier transfer. Pick **one** integration mode — both are scaffolded so you can choose
"whatever runs smoothly with least config".

> ViciDial's trunk layer is still primarily `chan_sip` (with PJSIP migration possible). All telephony —
> outbound, inbound, transfers, 3-way, conferencing — is ultimately Asterisk doing the work.

## Mode 1 — SIP trunk to Vapi (recommended, least config) ✅

Treat Vapi like any other carrier. ViciDial dials the lead, then bridges the answered call to the Vapi
SIP URI; Vapi runs Savannah and transfers eligible leads to the verifier.

**Steps**
1. **Admin → Carriers → Add a new carrier** (a.k.a. trunk). Name it `vapi_trunk`
   (`VICIDIAL_SIP_TRUNK_NAME`).
2. Set the carrier's dialplan/registration to point at your Vapi **SIP URI**
   (`VAPI_SIP_URI`, e.g. `sip:leadgen@sip.vapi.ai`). See `vicidial/carrier-and-transfer.md` for the
   sip.conf / extensions template.
3. On the Vapi side, create the **`byo-sip-trunk`** credential and **whitelist ViciDial's signaling
   IP(s)** (otherwise inbound to Vapi → `401`). Inbound gateway must be an **IPv4**.
4. Create an outbound **campaign** (`PHARMA01`) whose dial route sends answered calls through
   `vapi_trunk` to the assistant.
5. Set the campaign's **3-way / outbound CallerID** appropriately (it's a campaign detail setting) so
   the verifier sees the right number on transfer.

**Transfer:** with Mode 1, Vapi's `transferCall` does the warm/3-way to the verifier (see
`docs/vapi-setup.md` §5). If your verifier line isn't Twilio-backed and the summary won't play, do the
3-way **inside ViciDial** instead (Mode 2 / agent-style 3-way; template in
`vicidial/carrier-and-transfer.md`).

## Mode 2 — ViciDial Non-Agent API (Click-to-Call) + ViciDial 3-way

Use ViciDial's **non-agent API** to originate calls programmatically and let **ViciDial** own the
3-way transfer to the verifier (Vapi just talks; the transfer is an Asterisk conference).

- Enable an API user (`VICIDIAL_API_USER`/`PASS`) with non-agent API access.
- Originate: `GET {VICIDIAL_BASE_URL}/agc/api.php?source={VICIDIAL_SOURCE}&user=...&pass=...&function=external_dial&value=<phone>&phone_code=1&campaign=PHARMA01&...`
- For the transfer, ViciDial bridges the verifier into the call (3-way conference). ViciDial supports
  **SIP-REFER** transfers to carriers (e.g. handing the leg to the verifier's PSTN number) and native
  3-way conferences. Configure the verifier number as the transfer target.

> Mode 2 is heavier (you manage origination + conference logic) but keeps **all telephony in ViciDial**,
> which some carriers/verifier setups prefer. Mode 1 is the lighter path.

## Dispositions & DNC
- Map Vapi outcomes → ViciDial dispositions: `TRANSFERRED`, `NI` (not interested), `DNC`, `CALLBACK`,
  `NA` (no answer). Push these from the `vapi-control` `/vapi` webhook (`end-of-call-report`) back via
  the ViciDial API.
- **Honor opt-outs:** when Savannah marks `DNC`, add the number to ViciDial's DNC list. The prompt
  treats opt-out as highest priority — keep it that way for compliance.

## Practical Asterisk/SIP tips (from ViciDial community)
- Match **codecs** (ulaw/alaw) end to end and watch **NAT** settings, or you'll get one-way / no audio.
- Carriers authenticate trunks by **IP** or **user/pass** — make sure Vapi's whitelist matches your
  ViciDial public IP.
- Test the full path early: outbound dial → bridge to Vapi → transfer to verifier → 3-way audio.

## Sources
- VICIdial Asterisk configuration (SIP, codecs, NAT) — https://vicistack.com/blog/vicidial-asterisk-configuration/
- Set up SIP trunk/carrier in ViciDial — https://altotelecom.com/how-to-setup-your-sip-trunk-carrier-provider-in-vicidial-vicidialnow-goautodial-vicibox/
- Switch2VoIP ViciDial carrier setup — https://switch2voip.us/setup-sip-trunk-carrier-provider-vicidial-goautodial
- ViciDial SIP-REFER transfers (forum) — https://www.vicidial.org/VICIDIALforum/viewtopic.php?f=4&t=41886
- VICIdial carrier selection — https://vicistack.com/blog/vicidial-carrier-selection/
