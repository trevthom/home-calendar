// js/state.js — single source of truth. Reactive observable.
//
// Every mutator applies the change locally and emits, then fires the
// matching sync.js call as fire-and-forget. The UI never blocks on the
// network. If the network fails, the local change still stands and
// localStorage still saves it; next poll reconciles.
//
// `replaceServerData` is the one mutator that does NOT push to sync — it's
// how the poll loop and initial sync feed remote state in.

import { uid } from "./utils.js";
import { load, save } from "./storage.js";
import {
  pushEvent, patchEvent, deleteEventRemote,
  pushCalendar, patchCalendar, deleteCalendarRemote,
  pushReplace, onServerVersion,
} from "./sync.js";

/* ---------- Default seed data ---------- */

const DEFAULT_PALETTE = [
  "#c84a31", "#c98817", "#7e8c3c",
  "#2f7a78", "#3e4d8c", "#7a3d6b", "#4a4a4a",
];

function seed() {
  const personal = {
    id: uid(),
    name: "Personal",
    color: "#c84a31",
    visible: true,
  };
  return {
    calendars: [personal],
    events: [],
    ui: {
      year: new Date().getFullYear(),
      month: new Date().getMonth(),
      sidebarCalendarsCollapsed: false,
      sidebarUpcomingCollapsed: false,
      sidebarCountdownCollapsed: false,
    },
  };
}

/* ---------- Store ---------- */

let _state = load() || seed();
const _subs = new Set();

// Last-known server version. 0 means "haven't talked to server yet".
// Tracked here so sync.js's poll loop can compare cheaply. sync.js calls
// the listener below for every API response that includes a version field,
// which keeps us in sync after our own pushes (so we don't re-fetch state
// we just sent).
let _serverVersion = 0;
onServerVersion((v) => {
  if (v > _serverVersion) _serverVersion = v;
});

export const palette = () => DEFAULT_PALETTE;

export function getState() {
  return _state;
}

export function getServerVersion() {
  return _serverVersion;
}

export function subscribe(fn) {
  _subs.add(fn);
  return () => _subs.delete(fn);
}

function emit() {
  save(_state);
  _subs.forEach((fn) => fn(_state));
}

/* ---------- UI-only mutations (not synced) ---------- */
/* `ui` is per-device: current month, sidebar collapsed state. Each user
   navigates independently; we never sync these to the server. */

export function setView(year, month) {
  while (month < 0)  { month += 12; year -= 1; }
  while (month > 11) { month -= 12; year += 1; }
  _state = { ..._state, ui: { ..._state.ui, year, month } };
  emit();
}

export function setCalendarsCollapsed(collapsed) {
  _state = {
    ..._state,
    ui: { ..._state.ui, sidebarCalendarsCollapsed: collapsed },
  };
  emit();
}

export function setUpcomingCollapsed(collapsed) {
  _state = {
    ..._state,
    ui: { ..._state.ui, sidebarUpcomingCollapsed: collapsed },
  };
  emit();
}

export function setCountdownCollapsed(collapsed) {
  _state = {
    ..._state,
    ui: { ..._state.ui, sidebarCountdownCollapsed: collapsed },
  };
  emit();
}

/* ---------- Calendar mutations (synced) ---------- */

export function addCalendar(name, color) {
  const cal = { id: uid(), name, color, visible: true };
  _state = { ..._state, calendars: [..._state.calendars, cal] };
  emit();
  pushCalendar(cal);
  return cal;
}

export function updateCalendar(id, patch) {
  _state = {
    ..._state,
    calendars: _state.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  };
  emit();
  patchCalendar(id, patch);
}

export function deleteCalendar(id) {
  _state = {
    ..._state,
    calendars: _state.calendars.filter((c) => c.id !== id),
    // Cascade: drop events that belong to this calendar (server cascades too)
    events: _state.events.filter((e) => e.calendarId !== id),
  };
  emit();
  deleteCalendarRemote(id);
}

export function toggleCalendarVisibility(id) {
  const cal = _state.calendars.find((c) => c.id === id);
  if (cal) updateCalendar(id, { visible: !cal.visible });
}

/* ---------- Event mutations (synced) ---------- */

export function addEvent(ev) {
  const newEv = { id: uid(), ...ev };
  _state = { ..._state, events: [..._state.events, newEv] };
  emit();
  pushEvent(newEv);
  return newEv;
}

export function updateEvent(id, patch) {
  _state = {
    ..._state,
    events: _state.events.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  };
  emit();
  patchEvent(id, patch);
}

export function deleteEvent(id) {
  _state = { ..._state, events: _state.events.filter((e) => e.id !== id) };
  emit();
  deleteEventRemote(id);
}

/**
 * Add an exception (skipped) date to a recurring event. Used by
 * "delete only this occurrence" on a recurring event.
 */
export function addEventException(id, dateKey) {
  let newExdates = null;
  _state = {
    ..._state,
    events: _state.events.map((e) => {
      if (e.id !== id) return e;
      newExdates = [...(e.exdates || []), dateKey];
      return { ...e, exdates: newExdates };
    }),
  };
  emit();
  if (newExdates) patchEvent(id, { exdates: newExdates });
}

/** Wholesale replace from .ics import. */
export function replaceData({ calendars, events }) {
  const nextCalendars = calendars && calendars.length ? calendars : _state.calendars;
  const nextEvents = events || [];
  _state = {
    ..._state,
    calendars: nextCalendars,
    events: nextEvents,
  };
  emit();
  pushReplace({ calendars: nextCalendars, events: nextEvents });
}

/* ---------- Remote-driven update (from sync.js) ---------- */

/**
 * Replace calendars + events from a server snapshot WITHOUT pushing back.
 * Called by the initial sync and the poll loop. UI state (`ui`) is left
 * intact — each device keeps its own current month / sidebar collapsed
 * state.
 */
export function replaceServerData({ calendars, events, version }) {
  const v = version | 0;
  if (v > _serverVersion) _serverVersion = v;
  _state = {
    ..._state,
    calendars: calendars || [],
    events: events || [],
  };
  emit();
}
