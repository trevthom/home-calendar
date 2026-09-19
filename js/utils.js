// js/utils.js — pure helpers shared by all modules

export const uid = () =>
  "id_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

// ---------- Date helpers ----------

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const DAYS_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
export const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

/** Build a YYYY-MM-DD string in local time (avoids UTC drift). */
export function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD into a Date at local midnight. */
export function fromDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Today's date key (in local time). */
export const todayKey = () => toDateKey(new Date());

/** Add `n` days to a date (returns a new Date). */
export function addDays(d, n) {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

/** Last day of given month (Date object). */
export function endOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

/** Returns 6×7 = 42 Dates for the visible month grid (incl. leading/trailing). */
export function buildMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay(); // 0 = Sun
  const start = addDays(first, -startOffset);
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
  return cells;
}

/** Format "9:30 AM" (or 24h based on browser locale-ish; we keep it simple). */
export function formatTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ---------- DOM helpers ----------

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "style" && typeof v === "object") {
      // Custom properties (--foo) must use setProperty; they're silently
      // dropped by Object.assign(node.style, ...).
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith("--")) node.style.setProperty(prop, val);
        else node.style[prop] = val;
      }
    }
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}
