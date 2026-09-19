# HANDOFF — Calendar App

> Paste this file into the start of the next chat. It's the smallest amount
> of context a fresh Claude needs to make changes without re-reading everything.

## What this is

Vanilla-JS month-view calendar. No framework. The frontend is identical
across every run mode; only the backend differs. Four ways to run:

- **`dist/index.html` standalone** — open via `file://`, localStorage only.
  Each device is its own island. Used for phones without infra.
- **modular source** (`index.html` + `css/` + `js/`) — for editing. Requires
  `python3 -m http.server` because of ES modules. Run `python3 build.py`
  after edits to regenerate `dist/`.
- **`python3 server.py` + Tailscale Serve** — shared backend on a home
  desktop, accessed by devices on the tailnet. Data in `data/calendar.json`.
  `CALENDAR_PASSCODE` optional here (the tailnet is the auth).
- **`python3 server.py --host 0.0.0.0` — HOME WEB SERVER mode** — same
  backend bound to the LAN so any device on the home WiFi reaches it at
  http://<lan-ip>:8765. Startup prints the auto-detected LAN URL and WARNS
  loudly if `CALENDAR_PASSCODE` is unset on a non-loopback bind. See
  `HOME-SERVER.md` for autostart (systemd/launchd/Task Scheduler), DHCP
  reservation, and backups. Plain HTTP — never port-forward it to the
  internet; use the Vercel deployment for public access.
- **Vercel + Upstash Redis** — public HTTPS, one shared calendar behind one
  login (`CALENDAR_PASSCODE` env var). Serverless functions in `api/`
  replace `server.py`; data is one blob in Upstash Redis. This is the
  current production target. See `DEPLOY-VERCEL.md`.

**LOGIN MODEL (current).** ONE calendar, ONE login string. The owner sets it
as the `CALENDAR_PASSCODE` env var on Vercel; the client sends whatever the
user typed via the `X-Calendar-Login` header on every request, and the
server does a constant-time equality check. Match → the single shared
store; mismatch/missing/env-unset → 401 (fail closed). `server.py` does the
same check but treats the env var as optional (unset = accept any
valid-format login, for tailnet use); either way it routes to one store,
`data/calendar.json`. The login screen verifies against `/api/version`
BEFORE storing, so a typo shows "Incorrect login" inline rather than a
reload/401 loop. "Stay logged in": checked → `localStorage` (survives
browser close); unchecked → `sessionStorage` only. On a 401 at runtime
(owner rotated the passcode), `app.js` clears the stale stored login and
shows the overlay. There is NO per-login multi-tenancy any more — do not
reintroduce login hashing into storage keys.

**Key design point: the same `js/sync.js` frontend talks to BOTH backends.**
The desktop `server.py` and the Vercel `api/*` functions implement the exact
same HTTP contract (`GET/PUT /api/state`, `GET /api/version`,
`POST/PATCH/DELETE /api/events[/:id]`, same for calendars) AND both read the
`X-Calendar-Login` header, returning 401 if it's missing/invalid. A 401
triggers the login overlay. Keep the two backends in sync when you change
the API contract.

## File map

```
index.html         shell only — links css/, loads js/app.js as ES module
build.py           inlines all css+js into dist/index.html
server.py          DESKTOP backend: stdlib Python, serves dist/ + /api/, data.json
data.json          desktop server's database (created on first write)

api/               VERCEL backend (serverless functions, Node ESM)
  _lib/auth.js       reads/validates X-Calendar-Login; loginKey() = sha256 hash
  _lib/store.js      Upstash Redis read/write, ONE blob (calendar:state:v1)
  state.js           GET/PUT /api/state       (login-scoped)
  version.js         GET /api/version         (login-scoped)
  events/index.js    POST /api/events
  events/[id].js     PATCH/DELETE /api/events/:id
  calendars/index.js POST /api/calendars
  calendars/[id].js  PATCH/DELETE /api/calendars/:id (cascades events)
                     (NOTE: there is no api/login.js — identity is header-based)
package.json       declares @upstash/redis; "type":"module"
vercel.json        static frontend + no-cache headers on HTML
.vercelignore      keeps server.py/dist/docs/data out of the Vercel bundle
DEPLOY-VERCEL.md   end-user deploy + login guide

data/              DESKTOP store: single data/calendar.json
                   (gitignored; created on first write)

css/   variables · reset · layout · sidebar · calendar · upcoming · countdown · modal · login
       (layout.css owns the drawer + backdrop + hamburger; sidebar.css
        owns the drawer's internal content; login.css is the login overlay;
        countdown.css is the sidebar Countdown section)
js/    app          entry; gates boot on login, then boots UI + sync
       session      login identity: get/set/clear; localStorage vs sessionStorage
       state        single source of truth; observable; persists via storage.js
       sync         HTTP adapter; sends X-Calendar-Login; initial sync + 5s poll + 401 hook
       login        login overlay (input + "stay logged in" checkbox)
       countdown    sidebar Countdown section (events flagged countdown:true)
       storage      localStorage wrapper (still namespaced by typed login;
                    harmless, keeps caches separate if passcode rotates)
       utils        pure helpers (date math, DOM, el())
       events       pure: eventOccursOn, expandRange, getUpcoming, eventColor
       ics          .ics import/export (RFC 5545 subset)
       grid         month grid render + nav buttons
       modal        event create/edit + 3-way delete confirmation
       dayModal     day-detail dialog opened from grid's "+N more" chip
       sidebar      drawer toggle, calendar list, theme, import/export
       upcoming     next-10-events list (collapsible)
```

Build order matters in `build.py JS_ORDER`: utils → storage → **sync** →
state → events → ics → modal → dayModal → grid → upcoming → sidebar → app.

## State shape (in localStorage, key `calendar-app:v1`)

```js
{
  calendars: [{ id, name, color, visible }],   // default seed: just "Personal"
  events: [{
    id, calendarId, title,
    date,                  // "YYYY-MM-DD"
    allDay,                // bool
    startTime, endTime,    // "HH:MM" 24h, or ""
    repeat,                // "none"|"weekly"|"biweekly"|"monthly"|"yearly"
    exdates,               // string[] of "YYYY-MM-DD" — skipped instances
    color,                 // null = inherit calendar color
    location, description
  }],
  ui: {                    // PER-DEVICE — never synced
    year, month,
    sidebarCalendarsCollapsed,
    sidebarUpcomingCollapsed,
  }
}
```

Note: there's no `visibility` field on events any more. Events stored in
older localStorage may still have `visibility: "private" | "public"` on
them — silently ignored on read and dropped on the next save (since
it's never copied through any mutator). Same for `CLASS:` in .ics files.

Theme stored separately under `calendar-app:v1:theme`. Also per-device.

Server's `data.json` mirrors `{calendars, events}` plus a top-level
`version` integer. The `ui` block is local-only and never sent to the
server.

## Backend API

```
GET    /                  → dist/index.html
GET    /api/state         → { calendars, events, version }
GET    /api/version       → { version }     (cheap polling endpoint)
POST   /api/events        → upsert event (body must contain id)
PATCH  /api/events/:id    → partial update
DELETE /api/events/:id    → remove
POST   /api/calendars     → upsert calendar
PATCH  /api/calendars/:id → partial update
DELETE /api/calendars/:id → remove (cascades to events with that calendarId)
PUT    /api/state         → bulk replace (used by .ics import)
```

Every mutation bumps a monotonic `version` and is persisted atomically
(write to tmp, fsync, rename). Every mutation response includes the new
`version`. Concurrency: simple last-write-wins per field; for a
two-person calendar this is fine.

## Architectural rules

1. **Only state.js mutates state.** Every UI module imports mutators
   (`addEvent`, `updateCalendar`, …). Never mutate `getState()` directly.
2. **state.js emits after every mutation.** All UI modules subscribe and
   re-render. Adding a new view = `subscribe(render)` in its init.
3. **Pure modules stay pure.** `utils.js` and `events.js` have no DOM, no
   storage. Test them by importing in node.
4. **Recurrence is computed lazily.** No instance bloat. `eventOccursOn(ev,
   dateKey)` checks `exdates` first, then returns true on the right cadence.
5. **Color flows via CSS custom properties.** `el(..., { style: { "--cal-color": "#abc" }})`.
   utils.js's `el()` uses `setProperty` for `--*` keys (Object.assign drops them).
6. **`[hidden]` is forced to `display: none !important`** in reset.css —
   needed because `.modal__form` has `display: flex`.
7. **Two modals, never simultaneously open.** `#modal` (event editor) and
   `#day-modal` (day detail) each register their own ESC keydown listener,
   but always close one before opening the other. Day modal's "click an
   event" path explicitly closes itself first, then calls `openModal`.
8. **Modal panels never scroll horizontally.** Both `.modal__panel` and
   `.day-modal__list` set `overflow-x: hidden`, because `overflow-y: auto`
   alone makes the cross-axis compute to `auto`. `.day-modal__item` sets
   `min-width: 0`; `.day-modal__loc` uses `overflow-wrap: anywhere`.
9. **Sync is fire-and-forget.** Mutators in `state.js` apply locally and
   emit *first*, then call into `sync.js` without awaiting. UI never
   blocks on the network. If a push fails, `sync.js` logs and the local
   change stands; the next poll reconciles.
10. **`ui` block never syncs.** Each device keeps its own view state
    (current month, sidebar collapsed, theme). Only `calendars` and
    `events` are server-shared. `replaceServerData` in state.js
    intentionally leaves `_state.ui` alone.
11. **sync.js → state.js is one-way.** State imports from sync; sync calls
    back into state via callbacks (`onServerVersion`, `onRemoteChange`)
    registered at boot. Don't introduce a `sync.js` `import` of
    `state.js` — it'll create a cycle.

## Where to make common changes

| Change                           | File(s)                                      |
| -------------------------------- | -------------------------------------------- |
| Retheme colors / fonts           | `css/variables.css`                          |
| New event field                  | `state.js` mutator, `index.html` form, `modal.js` read/write, `ics.js` round-trip, `dayModal.js` if it should show in the day list; **also** add it to the patch payload if `updateEvent` uses partial PATCH — currently it sends the same patch object straight through, so any field in `patch` is round-tripped automatically |
| New repeat cadence               | `events.js` (`eventOccursOn`), `ics.js` (`rrule`/`parseRRule`), `index.html` select option |
| New view (week/day)              | New `js/<view>.js`, register in `app.js`, register in `build.py JS_ORDER` |
| Different storage backend        | `server.py` (or replace), and `js/sync.js` if wire format changes |
| Different poll cadence           | `POLL_MS` in `js/sync.js`                    |
| Auth (e.g. shared-secret header) | Wrap `req()` in `sync.js` to set the header, check it on every handler in `server.py` |
| New sidebar button               | `index.html` + `css/sidebar.css` + handler in `sidebar.js` |
| New collapsible sidebar section  | Mirror `upcoming.js` / `upcoming.css`: a `__header > __toggle > __chev` button, `data-collapsed` on the section, max-height + opacity transition on the content |

## Editing workflow

```bash
# develop
python3 -m http.server 8000   # http://localhost:8000 — localStorage only
# edit files in css/ or js/
# refresh browser

# build
python3 build.py              # regenerates dist/index.html (~73KB w/ sync)

# run shared backend
python3 server.py             # http://127.0.0.1:8765, serves dist/ + /api/
tailscale serve 8765          # in another terminal — exposes to tailnet
```

## Things that have already been fixed (do not "fix" again)

- `el()` uses `setProperty` for CSS custom properties (utils.js).
- The `Calendars` header is a `<div>` with two sibling `<button>`s; was
  previously an invalid button-in-button.
- `[hidden]` rule in reset.css overrides `display: flex` (needed for the
  modal form/confirm panel swap).
- Default seed has only one calendar ("Personal").
- Export icon is `↑`, Import is `↓`.
- Theme button font-size is 22px (`.icon-btn--theme`).
- Recurring-event delete uses 3-button confirm panel inside the modal:
  Cancel / Just this one / Entire series. Single-instance delete writes to
  `event.exdates`. Round-trips through ICS as `EXDATE;VALUE=DATE:`.
- **Visibility field was removed.** Don't reintroduce `f-visibility`,
  `visibility:` on the event object, or `CLASS:` in ICS round-trip.
- **Upcoming section is collapsible.** Toggle is `#upcoming-toggle`;
  `data-collapsed="true"` on `#upcoming` hides the list via max-height +
  opacity. Persisted as `ui.sidebarUpcomingCollapsed`.
- **"+N more" opens the day-detail modal**, it's not a no-op. `dayModal.js`
  owns the open/close flow. Don't move that responsibility into `grid.js`.
- **Cell chip cap is `MAX_ROWS = 3` total rows in `grid.js`.** As soon as
  a day has `>= MAX_ROWS` events, the last row is reserved for "+N more"
  and only `MAX_ROWS - 1 = 2` chips are shown. So 3 events → 2 chips +
  "+1 more"; never 3 chips visible without an overflow indicator.
- **Day-modal does not scroll horizontally.** See architectural rule 8.
- **Sidebar is a slide-out drawer on both desktop and mobile**, NOT a
  permanent left column. The shell `.app` is no longer a 2-column grid —
  `.main` always fills the viewport. The hamburger button is the first
  child of `.cal-header` (col 1 of a `1fr auto 1fr` grid; col 3 is a
  `.cal-header__balance` spacer that keeps the title visually centered).
  Opening/closing toggles `data-open` on `#sidebar` AND
  `#sidebar-backdrop`; aria-expanded on `#sidebar-toggle` is the source
  of truth for the X-morph animation. Wiring lives in `initDrawer()`
  inside `sidebar.js`. Don't reintroduce the old `grid-template-columns:
  var(--sidebar-w) 1fr` shell.
- **Drawer ESC handler defers to open modals.** If the event or day modal
  is on top, ESC closes that first; the drawer's ESC listener short-
  circuits in that case. Don't change the order — both modal handlers
  also listen to ESC, and them all firing on the same keystroke would
  close the drawer behind an open modal.
- **Two backends, one HTTP contract.** `server.py` (desktop) and `api/*`
  (Vercel) must stay behaviorally identical: same routes, same version-bump
  semantics, same cascade-on-calendar-delete. If you add an endpoint or
  field, change BOTH. The frontend (`sync.js`) is backend-agnostic.
- **Login = one shared passcode gate.** Both backends read the
  `X-Calendar-Login` header and compare it (constant-time) against the
  `CALENDAR_PASSCODE` env var — required on Vercel (fail closed if unset),
  optional on `server.py` (unset = accept any valid-format login, tailnet
  is the auth). Match → the ONE shared store; mismatch → 401. No cookies,
  no `api/login.js`, no per-login storage hashing. Identity lives
  client-side in `js/session.js`; verification happens in `login.js`
  against `/api/version` BEFORE the string is stored.
- **"Stay logged in" = localStorage vs sessionStorage.** Checked → login in
  `localStorage` (survives browser close). Unchecked → `sessionStorage` only
  (browser clears it on full close = auto-logout). `getLogin()` prefers the
  remembered (localStorage) one, then session. Manual logout (⇥, `#logout-btn`
  in sidebar) clears both and reloads. Don't "simplify" these into one store.
- **App boot is gated on login.** `app.js` calls `getLogin()` first; if null
  it shows the login overlay and returns WITHOUT booting the data layer, so
  one login's events never flash before another's. Login submit reloads the
  page so boot re-runs with identity present.
- **401 → login overlay.** `sync.js` calls `onUnauthorized` on any 401;
  `app.js` wires it to `login.js`'s `showLogin()`. Happens on both backends
  now (both enforce the login header).
- **Storage is ONE Redis key** (`calendar:state:v1`) holding the single
  `{calendars, events, version}` blob. Desktop mirror: `data/calendar.json`.
  Not row-per-event. Last-write-wins.
- **Countdown section.** Events with `countdown:true` (checkbox `#f-countdown`
  in the modal, stored on the event, round-tripped in ICS as `X-COUNTDOWN`)
  appear in the sidebar "Countdown" section, ABOVE "Upcoming". Logic is
  `getCountdownEvents()` in `events.js`: non-recurring past events are
  dropped; recurring events resolve to their next on/after-today occurrence;
  sorted soonest-first. Render is `js/countdown.js`. Countdown ignores
  calendar visibility (it's an explicit per-event opt-in).
- **Sidebar section order is Countdown → Upcoming → Calendars** (in
  `index.html`). "Calendars" was intentionally moved BELOW "Upcoming"; don't
  reorder. Each section has its own collapsed flag in `ui`
  (`sidebarCountdownCollapsed`, `sidebarUpcomingCollapsed`,
  `sidebarCalendarsCollapsed`), all per-device (not synced).
- **HTML is served no-store everywhere.** `server.py` sends no-store/no-cache
  headers; `vercel.json` does the same for `/` and `/index.html`; and
  `index.html` carries matching `<meta http-equiv>` tags. This is what makes
  "refresh on access" reliable on phones. `sync.js` also polls on `focus`,
  `visibilitychange`, AND `pageshow.persisted` (iOS bfcache restore). Don't
  remove the pageshow listener — it's the only thing that catches Safari
  restoring a frozen page.
- **Sync layer fully shipped.** The backend (`server.py`) and `js/sync.js`
  exist and work; `state.js` mutators fire-and-forget through sync;
  `app.js` calls `initialSync` + `startPolling` at boot. UI block is
  intentionally local. Don't reintroduce a model where `ui` syncs.
- **Initial-sync seeding rule:** if the server is empty (version 0) and
  the local has data, we push local up; otherwise the server's snapshot
  replaces local. See `initialSync` in `sync.js`. Resist the urge to
  "merge" — for a two-person calendar last-write-wins is the right call.

## Known limitations / good follow-ups

- No drag-to-create. No drag-to-reschedule.
- No week or day view.
- No reminders/notifications.
- No multi-day event spans (an event lives on its `date` only; recurrence
  is separate).
- Time-zone unaware: everything is local time, no `TZID` in ICS.
- Day-detail modal currently shows events for one day only — it doesn't
  let you create another day's event without closing first.
- **No visible offline indicator.** If the backend dies, edits silently
  fall back to localStorage. `sync.js` already dispatches a `sync-status`
  CustomEvent on `document` when online/offline flips; wiring a small
  dot somewhere in the sidebar would be ~10 lines.
- **No conflict resolution.** Concurrent edits on the same field by two
  devices = last write wins. Acceptable for two-user home use; would
  bite a team.
- **`updateEvent` payload size.** `patchEvent` currently sends the entire
  patch object that callers pass in. Callers (`modal.js`) pass the
  full event object, so PATCH effectively does a full replace. That's
  fine; switching to a real delta would only matter if events grew
  large.

## Testing

There's no test runner committed. Smoke-testing approach used during
development:

- pure modules (`events.js`, `ics.js`) — import into Node and assert
- bundled UI — Playwright + `file://` URL hits every interactive feature
- backend — `curl` against each endpoint, then restart and verify
  `data.json` round-trips
- sync — start `server.py`, open two browser windows pointed at it,
  edit on one, wait <5s, see it appear on the other
- chip-cap math — quick node one-liner asserting `(0..N)` → expected
  `(visible, overflow)` pairs

If you add something non-trivial, write a similar test before declaring done.

**Mobile UI verification:** `scripts/verify-mobile.mjs` (Playwright,
devDependency) drives headless Chromium against a running preview and
asserts the mobile contract end-to-end:

- no page scrolling, body `overflow: hidden`, app exactly fills the
  visual viewport (`100dvh`), `overscroll-behavior: none`;
- all four month/year arrows on one row inside the screen, close to the
  month/year text;
- today's date box top-right, slightly rounded, showing today's number,
  and clickable — clicking it jumps the view back to the current month;
- desktop regression pass (same checks, desktop-tolerant thresholds);
- interaction pass: month navigation + drawer open/close + today-badge
  click-to-jump keep the header correct.

Run it with:

```bash
PREVIEW_URL=http://127.0.0.1:8765 node scripts/verify-mobile.mjs
# first time: bun add -d playwright && bun x playwright install chromium
```

Exits non-zero if any check fails. Screenshots land in `/tmp/calendar-mobile-*.png`.
Equivalent: `npm run verify:mobile` (same script via package.json).

## Mobile viewport contract (2026-09)

The phone experience is a fixed, non-scrolling app surface. This was a
deliberate feature set — don't regress it when touching layout:

- **No page scrolling.** `reset.css` sets `body { overflow: hidden }` and
  `overscroll-behavior: none` on html/body; `.app` is `100dvh` (with a
  `100vh` fallback). Everything that scrolls (modals, day-modal list,
  drawer) scrolls INTERNALLY. If you add a surface that needs to scroll,
  make that element scroll — never re-enable body scroll.
- **Header fits one phone row.** Media queries at 700px and 360px shrink
  the title, nav buttons, and hamburger so all four month/year arrows stay
  inside the screen; gaps around the month/year text are tight on purpose.
- **Today badge.** `.cal-header__today` (#header-today) is a BUTTON in the
  header's right column: boxed, slightly rounded, shows today's date
  number (rendered in grid.js), and clicking it calls
  `setView(current year, current month)`. It has hover/active affordances.
- Modals use `dvh` fallbacks for max-height — keep them if you touch
  modal.css, or tall dialogs will be unreachable under the body lock.
