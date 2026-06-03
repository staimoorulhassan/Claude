# ViciDial ↔ Vapi Integration — SeniorCare (Option A)

**Flow:** ViciDial dials the lead → bridges the answered call to Vapi (Savannah qualifies) →
Savannah warm-transfers eligible leads to the closer/verifier queue.

```
ViciDial AIOUT campaign (RATIO 1:1)
  └─ dials lead from list 100001 "MED usa" (5,059 leads)
       └─ on answer → SIP/vapi-trunk → sip.vapi.ai  (Savannah / assistant bec20f66)
            └─ qualified → Vapi transferCall → closer queue DID → huclose verifier
```

---

## Known environment

| Item | Value |
|---|---|
| ViciDial admin | https://primesol.autelecom.net/vicidial/admin.php |
| Telephony server | Telephony3 — **46.225.136.17** |
| AI agent webphone | extension **9001** (SIP, group AiAgebts) |
| Outbound campaign | **AIOUT** ("USA Campaign"), RATIO 1:1, NEW leads, list 100001 |
| Closer/verifier campaign | **huclose** (Allow Closers Y, Inbound+Blended Y) |
| Carrier | **VAPI-SeniorCare** — SIP, dialplan `SIP/vapi-trunk/$[9${NXXNXXXXXX}]` |
| Vapi assistant | `37c1cb25-28c7-41b4-bdf0-dcea72331856` (Savannah) |
| Vapi phone number | `bec20f66-2bc6-41fc-856f-c51779736e87` |

---

## ✅ Already configured (confirmed)

- Carrier **VAPI-SeniorCare** active, SIP, dialplan entry set
- AIOUT: Quick Transfer = `PRESET_1`, Transfer Presets enabled, Transfer-No-Dispo = `LOCAL_AND_EXTERNAL`,
  3-Way CallerID = `CAMPAIGN`, Allowed Transfer Groups = `AGENTDIRECT`, Allow Closers = Y
- huclose: Allow Closers = Y, Allow Inbound and Blended = Y
- AI agent user group: all transfer types enabled

---

## ⚠️ Two gaps to close

### Gap 1 — Carrier Account Entry is empty (the SIP peer)

The carrier's **Account Entry** field is blank. Either paste the peer block there **or** add it
directly to `/etc/asterisk/sip.conf` on 46.225.136.17. Pick ONE place, not both.

**Account Entry / sip.conf block:**

```ini
[vapi-trunk]
type=peer
host=sip.vapi.ai
port=5060
context=trunkinbound
disallow=all
allow=ulaw
allow=alaw
dtmfmode=rfc2833
qualify=yes
insecure=port,invite
nat=force_rport,comedia
```

> If Vapi gives you **SIP credentials** for this trunk (Vapi dashboard → the SIP trunk credential),
> add `username=` / `secret=` / `fromuser=` and a `register=>` line. If Vapi is configured for
> **IP-based auth** (gateway = 46.225.136.17), no credentials are needed — the block above is enough.

After editing:
```bash
asterisk -rx "sip reload"
asterisk -rx "sip show peers" | grep vapi   # expect: vapi-trunk ... OK
```

### Gap 2 — Vapi must trust ViciDial's IP (BYO SIP trunk)

Because **ViciDial originates** the call (Option A), Vapi must accept inbound SIP from Telephony3.

In the **Vapi dashboard**:
1. **SIP Trunks** (or BYO Carrier) → create a SIP trunk credential
   - Gateway / origination IP = **46.225.136.17**
   - No outbound auth needed if IP-based
2. **Phone Numbers → `bec20f66...`**
   - Ensure it routes inbound SIP to **assistant `37c1cb25...`** (Savannah)
   - Set **Server URL** = `https://<your-project>.vercel.app/vapi`
3. Note the **E.164 number** assigned to `bec20f66` — ViciDial dials this number via the trunk.

---

## The warm transfer — important architecture note

ViciDial's `PRESET_1` / `AGENTDIRECT` transfer button is clicked by a **human agent** in the agent
screen. **Savannah is autonomous** — there is no human to click it. So the qualified-lead transfer
is driven from the **Vapi side** using the assistant's `transferCall` tool, which dials
`VERIFIER_NUMBER`.

`VERIFIER_NUMBER` must be a number that routes into the **huclose closer queue**:

- **Best:** a DID pointing at the huclose in-group (Vapi dials it → ViciDial rings the next free verifier).
- The ViciDial-native 3-way preset you configured remains as a **manual fallback** if you ever put a
  human agent on extension 9001.

> You still need to tell me the **closer-queue DID** (the number that rings huclose verifiers) so it
> can be set as `VERIFIER_NUMBER`. Find it in ViciDial → Inbound → DIDs (the DID routed to the
> huclose in-group), or create one.

---

## Go-live checklist

- [ ] Add `[vapi-trunk]` peer (carrier Account Entry **or** sip.conf) → `sip reload` → peer shows OK
- [ ] Vapi BYO SIP trunk trusts 46.225.136.17; number `bec20f66` → assistant `37c1cb25`
- [ ] Get Vapi E.164 number; confirm AIOUT carrier dialplan dials it correctly
- [ ] Get huclose closer-queue DID → set as `VERIFIER_NUMBER`
- [ ] Run `setup.js` (or the GitHub Action) to push env vars to Vercel + set Vapi Server URL
- [ ] Activate list 100001 + load hopper; set AIOUT Active = Y
- [ ] Place one test call → confirm Savannah answers, qualifies, transfers to verifier
- [ ] `GET /health` → `{"ok":true,"assistantId":"37c1cb25-...","phoneNumberId":"bec20f66-...","vercel":true}`
- [ ] Confirm lead row written (no Vapi recording — privacy requirement)

---

## Still needed from you

| Value | For | Where |
|---|---|---|
| **Closer-queue DID** | `VERIFIER_NUMBER` (Savannah's transfer target) | ViciDial → Inbound → DIDs (huclose) |
| **Vercel deployment URL** | `SERVER_URL` + Vapi Server URL | Vercel dashboard → Deployments |
| **Vapi E.164 number** | ViciDial dial target | Vapi → Phone Numbers → bec20f66 |
| **Vapi SIP creds (if any)** | sip.conf peer auth | Vapi → SIP Trunk credential |
