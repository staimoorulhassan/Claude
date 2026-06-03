# Call Flow — Step by Step

## Normal flow (eligible lead → verified transfer)

```
ViciDial AIOUT
  1. Hopper picks lead from list 100001 (MED usa)
  2. Dials lead number (RATIO 1:1)
  3. Lead answers
  4. ViciDial detects human answer (AMD)
  5. Bridges call → SIP INVITE → avr-asterisk :5060

avr-asterisk
  6. Accepts SIP call from 46.225.136.17
  7. Assigns CALL_UUID = Asterisk UNIQUEID
  8. Streams audio via AudioSocket → avr-core

avr-core
  9.  Opens Vapi STS session (VAPI_PRIVATE_KEY + VAPI_ASSISTANT_ID)
  10. Streams lead audio → Vapi STT (Deepgram nova-2)
  11. Vapi LLM (GPT-4o) runs SeniorCare system prompt (Savannah)
  12. Vapi TTS (Savannah voice) → audio → avr-core → AudioSocket → avr-asterisk → lead

Savannah (Vapi)
  13. "Hi, this is Savannah calling on a recorded line from SeniorCare..."
  14. Asks eligibility questions one at a time:
      Q1. Takes prescription medications?
      Q2. US resident?
      Q3. 18 or older?
      Q4. Coverage type?
      Q5. Interested in free delivery?

  ── NOT ELIGIBLE or DNC ──────────────────────────────────
  15a. Politely closes / adds to DNC
  15b. Call ends → end-of-call-report webhook → lead saved (outcome: NI/DNC)

  ── ELIGIBLE + INTERESTED ────────────────────────────────
  15c. "That's great — you may qualify. I'm connecting you with a
        US-based verification specialist. Please hold — don't hang up."
  15d. Triggers transferCall tool

Hub Control API (Vercel)
  16. Receives transfer-destination-request webhook from Vapi
  17. REST POST → avr-ami :3002 /transfer
      { uuid: CALL_UUID, extension: VERIFIER_NUMBER }

avr-ami
  18. Connects to ViciDial AMI (46.225.136.17:5038)
  19. Sends AMI Originate → dials VERIFIER_NUMBER (huclose closer DID)

ViciDial
  20. Rings huclose closer-queue
  21. Verifier agent answers
  22. ViciDial creates 3-way conference: lead + verifier + Savannah

Savannah
  23. Confirms: "I have [name] on the line for you — they're interested
       in the SeniorCare program. [Name], I'm leaving you with our
       specialist now. Have a great day!"
  24. Signals hub to drop the avr leg

Hub Control API
  25. REST POST → avr-ami /hangup { uuid: CALL_UUID }

avr-asterisk
  26. Hangs up the AVR call leg

ViciDial
  27. Maintains lead ↔ verifier bridge
  28. Verifier handles verification + disposition
  29. Call ends when either party hangs up

Hub Control API
  30. Receives end-of-call-report from Vapi
  31. Saves lead (outcome: TRANSFERRED) to data/leads.jsonl
```

## Opt-out / DNC flow

```
Lead: "remove me" / "not interested" / hostile
  → Savannah: "No problem — adding you to do-not-call. Sorry to bother you."
  → Call ends immediately
  → Lead saved: outcome=DNC
  → No transfer
```

## Transfer fails (all verifiers busy)

```
Savannah: "All our specialists are busy right now. Someone will call
           you right back — thank you!"
  → Call ends
  → Lead saved: outcome=CALLBACK
  → ViciDial auto-callback queue handles the follow-up
```

## Data captured per call

| Field | Source |
|---|---|
| `callId` | Vapi call ID |
| `callUUID` | Asterisk UNIQUEID |
| `phone` | Caller number (from ViciDial) |
| `outcome` | TRANSFERRED / NI / DNC / CALLBACK / NO_ANSWER |
| `first_name` | Extracted by Savannah |
| `takes_meds` | yes/no |
| `us_resident` | yes/no |
| `age_18_plus` | yes/no |
| `coverage_type` | Medicare / Medicaid / Insurance / Uninsured |
| `interested` | yes/no |
| `durationSec` | Call duration |

Stored in `data/leads.jsonl` (local server only — never pushed to repo or Vapi).
