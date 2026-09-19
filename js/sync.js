// js/sync.js — talks to the calendar backend over HTTP.
//
// Mutators in state.js fire-and-forget into this module after applying the
// change locally, so the UI never blocks on the network. If the backend is
// unreachable, mutations stay local (localStorage still works as a cache)
// and `_online` flips false. On the next successful request `_online` flips
// back true.
//
// The poll loop hits /api/version every POLL_MS — a tiny endpoint that
// returns just a counter — and only fetches the full /api/state when the
// counter has moved. So two idle devices cost ~12 small requests per
// minute total. On window focus / visibilitychange we poll immediately so
// switching back to the tab feels live.

import { getLogin } from "./session.js";

const API = "/api";
const POLL_MS = 5000;

// The login header name the backends read to scope storage per account.
const LOGIN_HEADER = "X-Calendar-Login";

let _online = true;
let _pollTimer = null;
let _onRemoteChange = null;     // (newState) => void   — provided by state.js
let _getLocalVersion = () => 0; // () => number          — provided by state.js
let _onVersion = null;          // (v) => void           — bumps state.js's _serverVersion
let _onUnauthorized = null;     // () => void            — provided by app.js; shows login

/** state.js calls this once at boot to be notified of every server version
 *  it sees, so it can avoid re-fetching state that originated from us. */
export function onServerVersion(fn) { _onVersion = fn; }

/** app.js registers a handler invoked whenever the backend returns 401,
 *  i.e. the login was missing or rejected by the server. The handler shows the
 *  login screen. No-op on the desktop/Tailscale backend, which never 401s. */
export function onUnauthorized(fn) { _onUnauthorized = fn; }

export function isOnline() {
  return _online;
}

function setOnline(v) {
  if (_online === v) return;
  _online = v;
  // Anyone who cares (e.g. a future status indicator) can listen for this.
  document.dispatchEvent(new CustomEvent("sync-status", { detail: { online: v } }));
  if (v) {
    // Came back online — pull latest state immediately
    pollNow();
  }
}

// ---------- low-level request ----------

async function req(method, path, body) {
  const opts = { method, headers: {}, credentials: "same-origin" };
  const login = getLogin();
  if (login) opts.headers[LOGIN_HEADER] = login;
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(API + path, opts);
  } catch (e) {
    setOnline(false);
    throw e;
  }
  if (!res.ok) {
    // 401 = the server rejected our login (missing/invalid header). Surface
    // the login screen so the user can re-enter it.
    if (res.status === 401) {
      if (_onUnauthorized) _onUnauthorized();
      throw new Error(`${method} ${path} → HTTP 401 (login required)`);
    }
    // 4xx isn't an "offline" condition — server's reachable, it just said no
    if (res.status >= 500) setOnline(false);
    throw new Error(`${method} ${path} → HTTP ${res.status}`);
  }
  setOnline(true);
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (parsed && typeof parsed.version === "number" && _onVersion) {
    _onVersion(parsed.version);
  }
  return parsed;
}

// ---------- read ----------

export async function fetchState() {
  return req("GET", "/state");
}

export async function fetchVersion() {
  const r = await req("GET", "/version");
  return r ? r.version : null;
}

// ---------- write (one per mutator in state.js) ----------

export function pushEvent(ev) {
  return req("POST", "/events", ev).catch(warn("pushEvent"));
}
export function patchEvent(id, patch) {
  return req("PATCH", `/events/${encodeURIComponent(id)}`, patch).catch(warn("patchEvent"));
}
export function deleteEventRemote(id) {
  return req("DELETE", `/events/${encodeURIComponent(id)}`).catch(warn("deleteEvent"));
}
export function pushCalendar(cal) {
  return req("POST", "/calendars", cal).catch(warn("pushCalendar"));
}
export function patchCalendar(id, patch) {
  return req("PATCH", `/calendars/${encodeURIComponent(id)}`, patch).catch(warn("patchCalendar"));
}
export function deleteCalendarRemote(id) {
  return req("DELETE", `/calendars/${encodeURIComponent(id)}`).catch(warn("deleteCalendar"));
}
export function pushReplace(data) {
  return req("PUT", "/state", data).catch(warn("pushReplace"));
}

function warn(label) {
  return (e) => {
    console.warn(`[sync] ${label} failed:`, e.message);
    // swallow — mutator already applied locally; next poll will reconcile
  };
}

// ---------- initial reconciliation ----------

/**
 * On boot, decide whether to take the server's state or push ours to it.
 *
 * - Server has data (version > 0)        → server wins; replace local
 * - Server fresh (version 0) AND local empty → nothing to do
 * - Server fresh (version 0) AND local has data → push local up
 *
 * The "local has data on a fresh server" case covers: you used the app
 * standalone for a while via localStorage, then later stood up the server.
 * Your existing data should survive the upgrade.
 */
export async function initialSync(getLocalSnapshot, applyRemote) {
  try {
    const remote = await fetchState();
    if (!remote) return;
    const localHasData =
      getLocalSnapshot().calendars.length > 0 ||
      getLocalSnapshot().events.length > 0;
    const serverIsEmpty =
      remote.version === 0 &&
      remote.calendars.length === 0 &&
      remote.events.length === 0;

    if (serverIsEmpty && localHasData) {
      const local = getLocalSnapshot();
      const r = await req("PUT", "/state", {
        calendars: local.calendars,
        events: local.events,
      });
      // After push, applyRemote so we record the new version locally
      applyRemote({
        calendars: local.calendars,
        events: local.events,
        version: r ? r.version : 1,
      });
      console.info("[sync] pushed local data to fresh server");
    } else {
      applyRemote(remote);
      console.info(`[sync] adopted server state (version ${remote.version})`);
    }
  } catch (e) {
    console.warn("[sync] initial sync failed, running offline:", e.message);
  }
}

// ---------- polling ----------

async function pollNow() {
  try {
    const v = await fetchVersion();
    if (v == null) return;
    if (v > _getLocalVersion()) {
      const remote = await fetchState();
      if (remote && _onRemoteChange) _onRemoteChange(remote);
    }
  } catch {
    // already flipped to offline inside req()
  }
}

export function startPolling({ getLocalVersion, onRemoteChange }) {
  _getLocalVersion = getLocalVersion;
  _onRemoteChange = onRemoteChange;

  if (_pollTimer) clearInterval(_pollTimer);
  _pollTimer = setInterval(pollNow, POLL_MS);

  // Poll immediately when the user returns to the tab — feels live without
  // having to wait for the next interval tick.
  window.addEventListener("focus", pollNow);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollNow();
  });
  // iOS Safari restores pages from its back/forward cache without firing
  // focus or visibilitychange. pageshow.persisted === true means we're
  // looking at a frozen snapshot that may be stale — force a poll.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) pollNow();
  });
}
