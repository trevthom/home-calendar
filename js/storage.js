// js/storage.js — localStorage cache, namespaced per login.
//
// Each login gets its own key, so different logins on the same browser keep
// completely separate calendars even offline. Theme is intentionally NOT
// namespaced — it's a device preference shared across logins.

import { getLogin } from "./session.js";

const BASE = "calendar-app:v1";

/** Per-login data key, e.g. "calendar-app:v1:data:alice". */
function dataKey() {
  const login = getLogin() || "__anon__";
  return `${BASE}:data:${login}`;
}

export function load() {
  try {
    const raw = localStorage.getItem(dataKey());
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function save(data) {
  try {
    localStorage.setItem(dataKey(), JSON.stringify(data));
  } catch (e) {
    console.warn("Storage save failed:", e);
  }
}

/* Theme is a device-wide preference, not per-login. */
export function loadTheme() {
  return localStorage.getItem(BASE + ":theme") || "light";
}

export function saveTheme(theme) {
  localStorage.setItem(BASE + ":theme", theme);
}
