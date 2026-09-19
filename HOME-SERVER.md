# Running the calendar on a home web server

This runs the whole thing — frontend and backend — on one computer in your
house (a desktop, an old laptop, a Raspberry Pi, a NAS that can run Python).
Every phone and computer on your WiFi opens it in a browser. No Vercel, no
Tailscale, no cloud accounts, no monthly anything. Your data is one JSON
file on your own machine.

Requirements: Python 3 (already on macOS and most Linux; on Windows install
it from python.org). Nothing else — no pip installs.

---

## Step 1 — Put the project on the server machine

Copy the project folder to the computer that will act as the server, then
build the frontend once:

```bash
cd home-calendar
python3 build.py
```

## Step 2 — Pick your login string and start the server

Your login is any string of letters and numbers, up to 50 characters. You
set it right on the command line (or as a system environment variable):

```bash
CALENDAR_PASSCODE=oakStreetKitchen2026 python3 server.py --host 0.0.0.0
```

On Windows (PowerShell):

```powershell
$env:CALENDAR_PASSCODE = "oakStreetKitchen2026"
python server.py --host 0.0.0.0
```

`--host 0.0.0.0` is what makes it reachable from other devices on your
network. The server prints the address to open, something like:

```
Open the calendar at:
    http://127.0.0.1:8765          (this machine)
    http://192.168.1.42:8765       (phones/laptops on your WiFi)
```

**Do set the login when using `--host 0.0.0.0`.** Without it, anyone who
joins your WiFi — guests, a neighbor who has the password — can read and
edit the calendar. The server prints a loud warning if you forget.

## Step 3 — Open it on your devices

On each phone/laptop connected to your home WiFi, open the printed LAN URL
(e.g. `http://192.168.1.42:8765`). Log in with your string, tick **"Stay
logged in on this device"**, and use the browser's **Add to Home Screen**
so it opens like an app.

Edits made on any device appear on the others within ~5 seconds.

---

## Making it survive reboots (recommended)

The server runs in the foreground. To make it start automatically:

**Linux (systemd)** — create `/etc/systemd/system/calendar.service`:

```ini
[Unit]
Description=Home calendar
After=network.target

[Service]
Environment=CALENDAR_PASSCODE=oakStreetKitchen2026
WorkingDirectory=/home/YOU/home-calendar
ExecStart=/usr/bin/python3 server.py --host 0.0.0.0
Restart=on-failure
User=YOU

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now calendar
```

**macOS (launchd)** — create
`~/Library/LaunchAgents/com.home.calendar.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.home.calendar</string>
  <key>ProgramArguments</key><array>
    <string>/usr/bin/python3</string>
    <string>server.py</string>
    <string>--host</string><string>0.0.0.0</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOU/home-calendar</string>
  <key>EnvironmentVariables</key><dict>
    <key>CALENDAR_PASSCODE</key><string>oakStreetKitchen2026</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict></plist>
```

Then `launchctl load ~/Library/LaunchAgents/com.home.calendar.plist`.

**Windows** — Task Scheduler → Create Task → trigger "At startup" →
action: `pythonw.exe` with arguments `server.py --host 0.0.0.0` and "Start
in" set to the project folder. Set CALENDAR_PASSCODE as a system
environment variable (System Properties → Environment Variables) first.

---

## Keeping the address stable

Routers can reassign device IPs, which would change the URL. Two fixes,
either works:

- **DHCP reservation (easiest):** in your router's admin page, reserve the
  server machine's current IP so it never changes.
- **Static IP:** set one manually on the server machine.

Then bookmark the URL once and it works forever.

---

## Backups

The entire calendar is one file: `data/calendar.json`. Copy it anywhere
(another disk, a cloud drive folder) whenever you like — it's written
atomically, so a copy taken at any moment is a consistent snapshot. To
restore, put it back and restart the server.

---

## Remote access when you're away from home

The LAN URL only works on your home WiFi. If you also want access from
elsewhere, the clean option is Tailscale on the server machine plus your
phones — then use `http://<machine-name>:8765` over the tailnet (you can
keep `--host 0.0.0.0`; Tailscale reaches it fine). Don't port-forward this
server directly to the internet: it speaks plain HTTP and isn't hardened
for public exposure. For a public URL, use the Vercel deployment instead
(see `DEPLOY-VERCEL.md`).

---

## Honest notes on the security model

- Traffic on your LAN is plain HTTP, so the login string travels
  unencrypted between your phone and the server. On your own home WiFi
  that's an acceptable trade for most families; it's not appropriate for
  shared/public networks.
- The login gates every read and write. Changing `CALENDAR_PASSCODE`
  (restart the server after) logs out every device immediately.
- If you skip the login on a LAN bind, the calendar is open to everyone on
  the network. The startup warning is there for a reason.

---

## Troubleshooting

**Phone can't reach the URL** — confirm phone and server are on the same
WiFi network (guest networks are often isolated); check the server machine's
firewall allows inbound connections on the port (Linux: `sudo ufw allow
8765`; Windows will prompt the first time; macOS: System Settings →
Network → Firewall).

**"Incorrect login"** — the string must match `CALENDAR_PASSCODE` exactly,
including capitals. If you changed the variable, restart the server.

**Everything stopped after a reboot** — set up the autostart service above.

**The URL changed** — your router reassigned the IP; set a DHCP
reservation.
