# ViciDial Carrier + Transfer — Config Templates

> Templates only. Replace every `CHANGE_ME` / `<...>`. Test in a lab before production. Exact field
> placement differs slightly by ViciDial version (Vicibox/GoAutoDial). In the GUI, most of this is
> entered under **Admin → Carriers**.

## A) Carrier to Vapi (Mode 1 — SIP trunk)

**Account Entry (sip.conf style)** — paste into the carrier's *Server IP / Registration* + *Account Entry*:
```ini
[vapi_trunk]
type=peer
host=sip.vapi.ai
; If Vapi gave you trunk auth, set these; many BYO trunks use IP auth instead:
;username=CHANGE_ME
;secret=CHANGE_ME
;fromuser=CHANGE_ME
disallow=all
allow=ulaw
allow=alaw
insecure=port,invite
nat=force_rport,comedia
qualify=yes
context=trunkinbound
```

**Dialplan Entry (extensions.conf style)** — how ViciDial sends an answered call to the assistant:
```ini
; 9 + number pattern routed to Vapi assistant via the SIP URI
exten => _91NXXNXXXXXX,1,AGI(agi://127.0.0.1:4577/call_log)
exten => _91NXXNXXXXXX,n,Dial(SIP/vapi_trunk/${EXTEN:1},,To)
exten => _91NXXNXXXXXX,n,Hangup()
```
> If Vapi routes by SIP URI user (e.g. `leadgen@sip.vapi.ai`), Dial to that user instead:
> `Dial(SIP/leadgen@vapi_trunk,,To)`. Match this to `VAPI_SIP_URI` in `config/.env`.

In the campaign (`PHARMA01`): set **Dial Prefix / route** to use `vapi_trunk`, set **Outbound CallerID**,
and (for ViciDial-side 3-way) set the **3-way Call Outbound CallerID** (campaign detail setting).

## B) Verifier transfer (two ways — pick one)

### B1) Let Vapi transfer (default, Mode 1)
Nothing to configure in ViciDial — Vapi's `transferCall` dials `VERIFIER_NUMBER` and bridges. Just make
sure your Vapi outbound trunk can reach US PSTN. See `docs/vapi-setup.md` §5.

### B2) ViciDial-side 3-way / SIP-REFER (Mode 2, or fallback if Vapi summary won't play)
Add a carrier for the verifier's PSTN path and a transfer extension:
```ini
[verifier_out]
type=peer
host=<your-pstn-carrier-host>
username=CHANGE_ME
secret=CHANGE_ME
disallow=all
allow=ulaw
insecure=port,invite
```
```ini
; Bridge the verifier into the call as a 3-way conference leg
exten => _8VERIFIER,1,Dial(SIP/verifier_out/CHANGE_ME_VERIFIER_NUMBER,,tT)
exten => _8VERIFIER,n,Hangup()
```
- For **SIP-REFER** style hand-off to the verifier's carrier, enable REFER on the verifier trunk and
  send the customer's CallerID (ViciDial supports REFER with the customer/inbound CallerID).
- For a **3-way conference**, use ViciDial's agent/conference (MeetMe/ConfBridge) so lead + verifier +
  (briefly) the agent share one bridge, then drop the agent leg.

## C) Sanity checklist
- [ ] Codecs match end-to-end (ulaw/alaw) — no one-way audio.
- [ ] NAT settings correct (`nat=force_rport,comedia`, valid externip if behind NAT).
- [ ] ViciDial public IP **whitelisted in Vapi** (else inbound `401`).
- [ ] Outbound CallerID + 3-way CallerID set on the campaign.
- [ ] DNC list honored; opt-outs from the agent push back to ViciDial DNC.
- [ ] Full path tested: dial → Savannah → eligible → transfer → verifier hears summary → 3-way audio OK.
