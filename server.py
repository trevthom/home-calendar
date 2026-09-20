#!/usr/bin/env python3
"""
server.py — minimal calendar sync backend.

Stdlib only. No virtualenv, no pip install.

Serves:
    /              the static frontend (dist/index.html — run build.py first)
    /api/state     GET full snapshot { calendars, events, version }
                   PUT bulk replace (used by .ics import)
    /api/version   GET cheap polling endpoint { version }
    /api/events    POST upsert an event (body must include id)
    /api/events/<id>
                   PATCH partial update
                   DELETE remove
    /api/calendars POST upsert a calendar (body must include id)
    /api/calendars/<id>
                   PATCH partial update
                   DELETE remove (cascades to events with that calendarId)

State is held in memory and persisted to data.json on every mutation
(atomic rename + fsync). `version` is a monotonic counter that bumps on
every write so the frontend can poll /api/version cheaply and only refetch
/api/state when something actually changed.

Run:
    python3 server.py                     # binds 127.0.0.1:8765 (this machine only)
    python3 server.py --port 9000         # custom port
    python3 server.py --host 0.0.0.0      # HOME SERVER: reachable on your LAN

Home-server mode (--host 0.0.0.0) makes the calendar reachable from every
device on your home network at http://<this-machine's-LAN-IP>:<port>.
STRONGLY recommended with it: set the login so guests on your WiFi can't
read or edit the calendar:

    CALENDAR_PASSCODE=yourString python3 server.py --host 0.0.0.0

Alternative for remote access without exposing anything: keep the default
loopback bind and use Tailscale Serve (HTTPS + tailnet-only access):
    tailscale serve 8765
"""

import json
import os
import re
import sys
import hmac
import hashlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, unquote

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"          # holds the single shared-calendar file
LEGACY_FILE = ROOT / "data.json"  # pre-login single-calendar file, if present
FRONTEND_FILE = ROOT / "dist" / "index.html"
TV_FILE = ROOT / "tv.html"   # ES5/legacy-browser display view (read-only)
DEFAULT_PORT = 8765

LOGIN_RE = re.compile(r"^[A-Za-z0-9]{1,50}$")

# ---------------------------------------------------------- per-login store ----
#
# Each login is a completely separate calendar. State lives in memory in
# _stores[login] and is persisted to data/<hash>.json on every mutation
# (atomic rename + fsync). `version` is a monotonic per-login counter so the
# frontend can poll cheaply and only refetch when it changes.

_lock = threading.Lock()
_stores = {}  # login -> {"calendars": [...], "events": [...], "version": N}


def _valid_login(login):
    return isinstance(login, str) and bool(LOGIN_RE.match(login))


def _login_hash(login):
    return hashlib.sha256(login.encode("utf-8")).hexdigest()[:32]


def _login_path(login):
    # There's only one store now ("shared") → one stable, readable filename.
    return DATA_DIR / "calendar.json"


def _empty():
    return {"calendars": [], "events": [], "version": 0}


def get_store(login):
    """Return the in-memory store for a login, loading it from disk on first
    access. Caller MUST hold _lock."""
    if login in _stores:
        return _stores[login]
    store = _empty()
    path = _login_path(login)
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as f:
                loaded = json.load(f)
            store["calendars"] = loaded.get("calendars", [])
            store["events"] = loaded.get("events", [])
            store["version"] = int(loaded.get("version", 0))
        except Exception as e:
            print(f"WARN: could not load {path}: {e}", file=sys.stderr)
    _stores[login] = store
    return store


def persist(login):
    """Atomic write of one login's store to disk. Caller MUST hold _lock."""
    DATA_DIR.mkdir(exist_ok=True)
    store = _stores[login]
    path = _login_path(login)
    tmp = path.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(store, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def bump(login):
    """Increment a login's version. Caller MUST hold _lock."""
    store = _stores[login]
    store["version"] = store.get("version", 0) + 1


# ----------------------------------------------------------- HTTP handler ----

class Handler(BaseHTTPRequestHandler):
    server_version = "CalendarSync/1.0"

    # Quieter log: one line per request, stderr only
    def log_message(self, fmt, *args):
        sys.stderr.write(
            f"[{self.log_date_time_string()}] {self.address_string()} "
            f"{fmt % args}\n"
        )

    # ---- helpers ----

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _login(self):
        """Verify the X-Calendar-Login header. There is ONE shared calendar.

        If the CALENDAR_PASSCODE environment variable is set, the header must
        match it exactly (constant-time compare) — same behavior as the
        Vercel deployment. If it's not set, any valid-format login is
        accepted (useful behind Tailscale, where the tailnet is the auth).

        Returns the fixed internal store key "shared" on success, or None
        (after writing a 401) on failure."""
        login = self.headers.get("X-Calendar-Login")
        if login is not None:
            login = login.strip()
        if not _valid_login(login):
            self._json(401, {"error": "incorrect or missing login"})
            return None
        expected = os.environ.get("CALENDAR_PASSCODE")
        if expected:
            if not hmac.compare_digest(login, expected):
                self._json(401, {"error": "incorrect or missing login"})
                return None
        return "shared"

    def _text(self, code, msg):
        body = msg.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _frontend(self):
        if not FRONTEND_FILE.exists():
            return self._text(
                500,
                "dist/index.html not found. Run `python3 build.py` first.",
            )
        body = FRONTEND_FILE.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Never let a phone serve a stale shell. The HTML is tiny, so
        # revalidating on every load costs nothing and guarantees that a
        # rebuild (or a fix) reaches both devices the next time they open
        # the page. no-store is the strongest: don't even keep a copy.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.end_headers()
        self.wfile.write(body)

    # ---- GET ----

    def do_GET(self):
        path = urlparse(self.path).path

        if path in ("/", "/index.html"):
            return self._frontend()

        # ---- TV view: read-only, NO login required ----
        # For old TV/legacy browsers that can't run the main app. Disable
        # both routes by setting CALENDAR_TV_VIEW=off. Note the tradeoff:
        # anyone who can reach this server can VIEW (never edit) the
        # calendar through these two routes.
        if path in ("/tv", "/tv.html", "/api/tv-state"):
            if os.environ.get("CALENDAR_TV_VIEW", "").lower() == "off":
                return self._text(404, "TV view is disabled")
            if path == "/api/tv-state":
                with _lock:
                    store = get_store("shared")
                    snapshot = {
                        "calendars": list(store["calendars"]),
                        "events": list(store["events"]),
                        "version": store["version"],
                    }
                return self._json(200, snapshot)
            if not TV_FILE.exists():
                return self._text(500, "tv.html not found next to server.py")
            body = TV_FILE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.end_headers()
            self.wfile.write(body)
            return

        if path == "/api/state":
            login = self._login()
            if login is None:
                return
            with _lock:
                store = get_store(login)
                snapshot = {
                    "calendars": list(store["calendars"]),
                    "events": list(store["events"]),
                    "version": store["version"],
                }
            return self._json(200, snapshot)

        if path == "/api/version":
            login = self._login()
            if login is None:
                return
            with _lock:
                v = get_store(login)["version"]
            return self._json(200, {"version": v})

        return self._text(404, "Not found")

    # ---- POST (upsert) ----

    def do_POST(self):
        path = urlparse(self.path).path
        login = self._login()
        if login is None:
            return
        try:
            body = self._read_json()
        except json.JSONDecodeError:
            return self._text(400, "Invalid JSON")
        if not isinstance(body, dict) or "id" not in body:
            return self._text(400, "Body must be a JSON object with an id")

        if path == "/api/events":
            with _lock:
                store = get_store(login)
                store["events"] = [e for e in store["events"] if e.get("id") != body["id"]]
                store["events"].append(body)
                bump(login)
                persist(login)
                return self._json(200, {"version": store["version"], "event": body})

        if path == "/api/calendars":
            with _lock:
                store = get_store(login)
                store["calendars"] = [
                    c for c in store["calendars"] if c.get("id") != body["id"]
                ]
                store["calendars"].append(body)
                bump(login)
                persist(login)
                return self._json(200, {"version": store["version"], "calendar": body})

        return self._text(404, "Not found")

    # ---- PATCH (partial update) ----

    def do_PATCH(self):
        path = urlparse(self.path).path
        login = self._login()
        if login is None:
            return
        try:
            patch = self._read_json() or {}
        except json.JSONDecodeError:
            return self._text(400, "Invalid JSON")

        if path.startswith("/api/events/"):
            # IDs can contain URL-significant chars (e.g. '@' on imported
            # events); clients percent-encode them, so decode before matching.
            ev_id = unquote(path[len("/api/events/"):])
            with _lock:
                store = get_store(login)
                for i, ev in enumerate(store["events"]):
                    if ev.get("id") == ev_id:
                        merged = {**ev, **patch, "id": ev_id}
                        store["events"][i] = merged
                        bump(login)
                        persist(login)
                        return self._json(
                            200, {"version": store["version"], "event": merged}
                        )
            return self._text(404, "Event not found")

        if path.startswith("/api/calendars/"):
            cal_id = unquote(path[len("/api/calendars/"):])
            with _lock:
                store = get_store(login)
                for i, c in enumerate(store["calendars"]):
                    if c.get("id") == cal_id:
                        merged = {**c, **patch, "id": cal_id}
                        store["calendars"][i] = merged
                        bump(login)
                        persist(login)
                        return self._json(
                            200, {"version": store["version"], "calendar": merged}
                        )
            return self._text(404, "Calendar not found")

        return self._text(404, "Not found")

    # ---- DELETE ----

    def do_DELETE(self):
        path = urlparse(self.path).path
        login = self._login()
        if login is None:
            return

        if path.startswith("/api/events/"):
            ev_id = unquote(path[len("/api/events/"):])
            with _lock:
                store = get_store(login)
                before = len(store["events"])
                store["events"] = [e for e in store["events"] if e.get("id") != ev_id]
                if len(store["events"]) == before:
                    return self._text(404, "Event not found")
                bump(login)
                persist(login)
                return self._json(200, {"version": store["version"]})

        if path.startswith("/api/calendars/"):
            cal_id = unquote(path[len("/api/calendars/"):])
            with _lock:
                store = get_store(login)
                before = len(store["calendars"])
                store["calendars"] = [c for c in store["calendars"] if c.get("id") != cal_id]
                if len(store["calendars"]) == before:
                    return self._text(404, "Calendar not found")
                # Cascade events belonging to this calendar (mirrors state.js)
                store["events"] = [
                    e for e in store["events"] if e.get("calendarId") != cal_id
                ]
                bump(login)
                persist(login)
                return self._json(200, {"version": store["version"]})

        return self._text(404, "Not found")

    # ---- PUT (bulk replace, used by .ics import) ----

    def do_PUT(self):
        path = urlparse(self.path).path
        login = self._login()
        if login is None:
            return
        try:
            body = self._read_json() or {}
        except json.JSONDecodeError:
            return self._text(400, "Invalid JSON")

        if path == "/api/state":
            if "calendars" not in body or "events" not in body:
                return self._text(400, "Need both 'calendars' and 'events'")
            with _lock:
                store = get_store(login)
                store["calendars"] = list(body["calendars"])
                store["events"] = list(body["events"])
                bump(login)
                persist(login)
                return self._json(200, {"version": store["version"]})

        return self._text(404, "Not found")


# ---------------------------------------------------------------- main ----

def _lan_ip():
    """Best-effort detection of this machine's LAN IP (no traffic is sent)."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))   # never actually transmits (UDP, no send)
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Calendar sync backend (stdlib only)")
    ap.add_argument("port_pos", nargs="?", type=int, default=None,
                    help="port (positional, backward compatible)")
    ap.add_argument("--port", type=int, default=None, help="port (default 8765)")
    ap.add_argument("--host", default="127.0.0.1",
                    help="bind address; use 0.0.0.0 to serve your whole LAN "
                         "(default 127.0.0.1 = this machine only)")
    args = ap.parse_args()
    port = args.port or args.port_pos or DEFAULT_PORT
    host = args.host

    DATA_DIR.mkdir(exist_ok=True)
    httpd = ThreadingHTTPServer((host, port), Handler)

    passcode_set = bool(os.environ.get("CALENDAR_PASSCODE"))
    lan_bound = host not in ("127.0.0.1", "localhost", "::1")

    print(f"Calendar backend listening on {host}:{port}")
    print(f"Data file: {DATA_DIR / 'calendar.json'}")
    print()
    print("Open the calendar at:")
    print(f"    http://127.0.0.1:{port}          (this machine)")
    if lan_bound:
        ip = _lan_ip()
        if ip:
            print(f"    http://{ip}:{port}       (phones/laptops on your WiFi)")
        else:
            print("    http://<this-machine's-LAN-IP>:{}  (couldn't auto-detect the IP;".format(port))
            print("        find it via `ip addr` / `ipconfig` / `ifconfig`)")
    print()
    if passcode_set:
        print("Login: CALENDAR_PASSCODE is set — devices must enter it to connect.")
    elif lan_bound:
        print("*** WARNING: serving your LAN with NO login set. Anyone on your ***")
        print("*** WiFi can read and edit the calendar. Strongly recommended:  ***")
        print(f"***     CALENDAR_PASSCODE=yourString python3 server.py --host {host} ***")
    else:
        print("Login: not enforced (loopback only). Any valid login string works.")
        print("For remote access via Tailscale (in another terminal):")
        print(f"    tailscale serve {port}")
    if LEGACY_FILE.exists():
        print()
        print(f"NOTE: found an old {LEGACY_FILE.name} from an earlier version.")
        print("      It is no longer read. Import your events via the app's")
        print("      Import (.ics) button after logging in, if you still need them.")
    if not FRONTEND_FILE.exists():
        print()
        print(f"NOTE: {FRONTEND_FILE} doesn't exist yet. Run `python3 build.py`.")
    print()
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        httpd.server_close()


if __name__ == "__main__":
    main()
