# Run the Lead Generation Hub on your Linux PC

This hosts the full hub stack (avr-asterisk, avr-core, avr-ami, avr-app) on your
own Linux machine. ViciDial (46.225.136.17) dials into it; it talks to Vapi for
the voice AI and back to ViciDial for the 3-way transfer.

> ⚠️ Your PC must stay **on and online** whenever the campaign runs. A home/office
> connection also needs **port-forwarding** and (if your IP changes) **DDNS**.

---

## 0. Check whether your public IP is static or dynamic

```bash
curl ifconfig.me ; echo
```
Run it now, reboot your router, run it again. If the number changed → **dynamic**
→ do Step 1 (DDNS). If it's the same → you can skip DDNS and just use the IP.

---

## 1. (If dynamic) Set up free DDNS — DuckDNS

1. Go to **duckdns.org**, sign in, create a subdomain e.g. `seniorcare-hub.duckdns.org`
2. Install the updater on your PC (keeps the hostname pointed at your current IP):

```bash
mkdir -p ~/duckdns && cd ~/duckdns
echo 'echo url="https://www.duckdns.org/update?domains=seniorcare-hub&token=YOUR_DUCKDNS_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -' > duck.sh
chmod 700 duck.sh
# run every 5 min
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
./duck.sh && cat duck.log   # should print: OK
```

From here on, use `seniorcare-hub.duckdns.org` wherever a host/IP is needed.

---

## 2. Install Docker (Linux)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version && docker compose version
```

---

## 3. Find your PC's LAN IP (for router port-forwarding)

```bash
ip route get 1 | awk '{print $7; exit}'    # e.g. 192.168.1.50
```

---

## 4. Forward ports on your router → your PC's LAN IP

| External port | Protocol | → Internal (your PC) |
|---|---|---|
| 5060 | UDP **and** TCP | 5060 |
| 10000–10100 | UDP | 10000–10100 |

(Router admin page → "Port Forwarding" / "Virtual Server". Point each to the LAN
IP from Step 3.)

---

## 5. Open the Linux firewall

```bash
sudo ufw allow 5060/udp
sudo ufw allow 5060/tcp
sudo ufw allow 10000:10100/udp
sudo ufw reload
```

---

## 6. Clone and configure

```bash
git clone https://github.com/staimoorulhassan/Claude lead-gen-hub
cd lead-gen-hub
cp .env.example .env
nano .env     # fill in the values below
```

Key `.env` values for a PC host:

```ini
VAPI_PRIVATE_KEY=7f934503-2faa-48ca-b46b-ade35a66b77c
VAPI_ASSISTANT_ID=37c1cb25-28c7-41b4-bdf0-dcea72331856

VERIFIER_NUMBER=+1XXXXXXXXXX          # huclose closer-queue DID
VICIDIAL_HOST=46.225.136.17
VICIDIAL_AMI_SECRET=...               # from AuTelecom / manager.conf

# Hub's own AMI secret (any value; must match asterisk/manager.conf)
AVR_ASTERISK_AMI_SECRET=avr-ami-2026
```

---

## 7. Point the ViciDial carrier at your PC

In ViciDial → Admin → Carriers → **VAPI-SeniorCare** → Account Entry, change the
host to your public IP **or** DDNS hostname (NOT sip.vapi.ai):

```ini
[vapi-trunk]
type=peer
host=seniorcare-hub.duckdns.org     ; ← your DDNS or static public IP
insecure=port,invite
qualify=yes
nat=force_rport,comedia
context=vapi-inbound
```

Then on the ViciDial server: `asterisk -rx "sip reload"`

---

## 8. Start the hub

```bash
docker compose up -d
docker compose ps                 # all services Up
docker compose logs -f avr-core   # watch the voice pipeline
```

Dashboard: <http://localhost:3000>  ·  Hub API: <http://localhost:3001>

---

## 9. Verify

```bash
# avr-asterisk sees ViciDial trunk
docker compose exec avr-asterisk asterisk -rx "pjsip show endpoints"

# avr-ami can reach ViciDial AMI
docker compose logs avr-ami | grep -i vicidial
```

Then place one test call from ViciDial (AIOUT) → you should hear Savannah, and an
eligible test lead should trigger the 3-way to the verifier.

---

## Notes / gotchas

- **RTP/NAT:** if you hear one-way or no audio, the RTP port-forward (10000–10100)
  or `nat=force_rport,comedia` is the usual cause. Confirm the forward is UDP.
- **PC sleeps:** disable sleep/suspend, or calls drop. `sudo systemctl mask sleep.target`
- **A VPS is more reliable** than a home PC for production volume — but this works
  for testing and low volume.
- **Vercel control API** (the `/vapi` webhook + lead capture) can run in parallel,
  or you can rely on the local avr-app. Both read the same env vars.
