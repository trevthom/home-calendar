# Calendar App

A modular, single-page calendar built with vanilla JavaScript ES modules.
No framework. Two ways to run:

- **Standalone, single-file** — `dist/index.html`, no server, no install.
  Stores everything in the browser's `localStorage`. Each device is its
  own island.
- **Shared, multi-device** — a small Python server (`server.py`) keeps a
  single source of truth on your desktop. Frontends on any device on your
  Tailscale network read and write through it, and changes propagate
  within a few seconds. This is the mode for "my wife and I both edit
  events from our phones."

## Quick start: standalone

Open `dist/index.html` in any browser. That's the whole setup. Events
live in `localStorage`. Use the ↑ Export and ↓ Import buttons in the
sidebar to move data between devices via `.ics` files.

## Quick start: shared via Tailscale

You need three things: this repo on your desktop, Python 3, and
Tailscale installed on both the desktop and every device you want to
edit from.

**1. On the desktop, build and start the backend:**

```bash
python3 build.py        # generates dist/index.html
python3 server.py       # serves the app + JSON API on 127.0.0.1:8765
```

The server is bound to localhost only — not exposed to your LAN, not
exposed to the internet. Data lives in `data.json` next to `server.py`.

**2. In another terminal, expose the port to your tailnet:**

```bash
tailscale serve 8765
```

Tailscale will print a URL like:

```
https://desktop.your-tailnet.ts.net
   |-- proxy http://127.0.0.1:8765
```

That URL is only reachable from devices on your tailnet, gets a real
HTTPS certificate automatically, and stays the same as long as the
desktop stays online.

**3. On each device, install Tailscale, sign into the same tailnet,
and open the URL.** Bookmark it / add to home screen.

Edits made on any device show up on the others within ~5 seconds (the
poll interval). Switching back to a tab triggers an immediate refresh,
so coming back from another app feels live.

### What's actually happening

The frontend boots from `localStorage` first (instant first paint, even
if the desktop is asleep or you're disconnected from Tailscale), then
asynchronously fetches `/api/state`. If the server has data, the
frontend adopts it. If the server is empty and your device has local
data, the frontend pushes it up. After that, every local mutation
optimistically updates the UI, writes to `localStorage`, and fires a
matching request to the backend. A 5-second poll of the cheap
`/api/version` endpoint detects changes made on other devices and
pulls the new snapshot.

If the backend is unreachable, the app silently falls back to
localStorage-only. You'll still be able to add and edit events; they
just won't propagate until you reconnect. On reconnect the server's
view wins for any field changed concurrently — last-write-wins
per-field. For a two-person calendar where you rarely edit at the
exact same moment, that's fine.

### Keeping the server running

`server.py` runs in the foreground. To survive logout / reboot:

- **macOS:** wrap it in a `launchd` plist under `~/Library/LaunchAgents/`.
- **Linux:** a systemd user unit (`systemctl --user enable …`).
- **Windows:** Task Scheduler "at logon" running `pythonw server.py`.

Or just leave a terminal open. For a home calendar this is fine.

### Backups

Copy `data.json` somewhere safe. That's the whole database. The
file is rewritten atomically (`tmp → rename`), so a copy taken at
any moment is a consistent snapshot.

## Editing the source

The modular source (`index.html` + `css/` + `js/`) uses ES modules,
which browsers refuse to load over `file://`. For development:

```bash
python3 -m http.server 8000      # http://localhost:8000
# edit files in css/ or js/, refresh browser
python3 build.py                 # regenerate dist/index.html when you ship
```

If you've also started `server.py`, the development server on port
8000 will be unreachable from sync — the development page is just
visualizing the localStorage cache. To test sync, point your browser
at the backend's port (`8765`) and edit the source-and-rebuild loop.

## Architecture

```
calendar-app/
├── index.html              ← Source. Loads modules. For development.
├── build.py                ← Bundles everything into dist/index.html.
├── server.py               ← Backend: serves dist/ + JSON API at /api/.
├── data.json               ← Server's database. Created on first write.
├── dist/
│   └── index.html          ← Self-contained build. Served by server.py.
├── css/                    ← variables · reset · layout · sidebar
│   …                         calendar · upcoming · modal
└── js/
    ├── app.js              ← Entry. Boots UI modules, then kicks off sync.
    ├── state.js            ← Single source of truth. Mutators sync.
    ├── sync.js             ← HTTP adapter. Initial sync + 5s poll loop.
    ├── storage.js          ← localStorage cache (fast first paint, offline).
    ├── utils.js            ← Pure helpers (dates, DOM, ids).
    ├── events.js           ← Recurrence expansion, range queries. Pure.
    ├── ics.js              ← .ics import / export.
    ├── grid.js             ← Month grid + month/year navigation.
    ├── modal.js            ← Event create / edit dialog.
    ├── dayModal.js         ← Day-detail dialog (opened by "+N more").
    ├── sidebar.js          ← Calendar list, theme toggle, import / export.
    └── upcoming.js         ← Next-10-events panel.
```

### Data flow

```
                  ┌──────────────┐
                  │   state.js   │  getState(), subscribe(), mutators
                  └──────┬───────┘
                         │ emits on every mutation
   ┌──────────┬──────────┼──────────────┬───────────┐
   ▼          ▼          ▼              ▼           ▼
 grid.js  sidebar.js  upcoming.js  modal.js   storage.js
                         │
                         │ (mutators also fire-and-forget)
                         ▼
                     sync.js ─── HTTP ───▶ server.py ─── data.json
                         ▲
                         │ 5s poll
                         ▼
                  state.replaceServerData()
```

Every UI module reads from `state.js` and re-renders when notified.
**No module mutates state directly** — they call mutators
(`addEvent`, `updateCalendar`, …) which update the store, notify
subscribers, and asynchronously push to the backend if it's
reachable. The poll loop in `sync.js` calls `replaceServerData`
when another device has made changes.

### What syncs and what doesn't

| Field                              | Synced? |
|------------------------------------|---------|
| calendars (name, color, visible)   | yes     |
| events (all fields)                | yes     |
| current month / year being viewed  | no — per device |
| sidebar collapsed state            | no — per device |
| theme (light/dark)                 | no — per device |

The UI block in `state` is intentionally local: each user can be
looking at a different month, with their sidebar however they like.

## API reference (only relevant if you replace the backend)

```
GET    /                       → dist/index.html
GET    /api/state              → { calendars, events, version }
GET    /api/version            → { version }
POST   /api/events             → upsert event   (body must include id)
PATCH  /api/events/:id         → partial update
DELETE /api/events/:id         → remove
POST   /api/calendars          → upsert calendar
PATCH  /api/calendars/:id      → partial update
DELETE /api/calendars/:id      → remove (cascades to events)
PUT    /api/state              → bulk replace (used by .ics import)
```

Every successful mutation response includes the new `version`.

## Extending

| Change                            | Files                                                |
| --------------------------------- | ---------------------------------------------------- |
| Retheme colors / fonts            | `css/variables.css`                                  |
| New event field                   | `state.js`, `index.html` form, `modal.js`, `ics.js`  |
| New repeat cadence                | `events.js`, `ics.js`, `index.html` select option    |
| Switch storage backend            | `server.py` (or replace it), `js/sync.js` if you change the wire format |
| Week / day view                   | New `js/<view>.js`, register in `app.js` + `build.py JS_ORDER` |
| Different sync cadence            | `POLL_MS` in `js/sync.js`                            |
| Auth (e.g. shared secret header)  | Wrap `req()` in `sync.js` + check on every handler in `server.py` |

## Browser support

Modern evergreen browsers (Chrome, Firefox, Safari, Edge) on desktop
and iOS / Android. Uses ES modules, `localStorage`, `fetch`, and
`Intl`-free date formatting. No polyfills required.
