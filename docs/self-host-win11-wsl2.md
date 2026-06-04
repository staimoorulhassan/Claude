# Self-Hosting the Full Hub on Windows 11 + WSL2 (Upgrade Path)

> This is the **optional upgrade** from the active Direct-to-Vapi path. Use it when
> you want ViciDial → your own Asterisk (avr-asterisk) → avr-core → Vapi, with the
> hub carrying the audio. Requires your stable public IPv4 (`202.47.32.170`).

## Why Windows 11 makes this feasible

Windows 11 (22H2+) supports **WSL2 mirrored networking mode**. WSL2 then shares the
Windows host IP instead of sitting behind its own NAT — no `netsh portproxy`, and it
survives reboots. Without this, WSL2's internal IP changes each boot and breaks SIP.

## 1. Enable WSL2 mirrored networking

Create/edit `C:\Users\Taimoor\.wslconfig`:

```ini
[wsl2]
networkingMode=mirrored
firewall=true
[experimental]
hostAddressLoopback=true
```

Then in PowerShell (admin):
```powershell
wsl --shutdown
wsl --version   # confirm WSL version 2.x and Windows 11
```
Restart WSL. Inside Kali, `ip address` should now show your host's IP, not `172.20.x`.

## 2. Router port-forward → your Windows PC LAN IP

| Port | Protocol |
|---|---|
| 5060 | UDP + TCP |
| 10000–10100 | UDP |

Point each to the Windows machine's LAN IP (find via `ipconfig` in PowerShell).

## 3. Windows Firewall — allow inbound

PowerShell (admin):
```powershell
New-NetFirewallRule -DisplayName "SIP-UDP" -Direction Inbound -Protocol UDP -LocalPort 5060 -Action Allow
New-NetFirewallRule -DisplayName "SIP-TCP" -Direction Inbound -Protocol TCP -LocalPort 5060 -Action Allow
New-NetFirewallRule -DisplayName "RTP" -Direction Inbound -Protocol UDP -LocalPort 10000-10100 -Action Allow
```

## 4. Start the hub in Kali/WSL2

```bash
cd ~ && git clone https://github.com/staimoorulhassan/Claude lead-gen-hub
cd lead-gen-hub
cp .env.example .env && nano .env     # fill VERIFIER_NUMBER, VICIDIAL_AMI_SECRET, etc.
docker compose up -d
docker compose ps
```

## 5. Point ViciDial carrier at YOUR public IP

ViciDial → Admin → Carriers → VAPI-SeniorCare → Account Entry:
```ini
[vapi-trunk]
type=peer
host=202.47.32.170        ; ← your public IPv4 (was sip.vapi.ai)
insecure=port,invite
qualify=yes
nat=force_rport,comedia
context=vapi-inbound
```
Then on ViciDial: `asterisk -rx "sip reload"`

Also set `externip=202.47.32.170` handling in `asterisk/pjsip.conf` (add an
`external_media_address` / `external_signaling_address` to the transport) so RTP
advertises the public IP, not the WSL2 internal one.

## 6. Verify

```bash
docker compose exec avr-asterisk asterisk -rx "pjsip show endpoints"   # vicidial-trunk
docker compose logs -f avr-core                                        # Vapi pipeline
```
Place a test call from AIOUT. You should hear Savannah; an eligible test lead should
trigger avr-ami → ViciDial 3-way to the huclose verifier.

## Caveats vs. a VPS

- Your PC must stay on, awake, and online 24/7 during campaigns.
- Home upload bandwidth limits concurrent calls (~8–10 calls per Mbps for G.711).
- A $5/mo VPS removes all of this — same steps, just on the VPS's native Linux.
