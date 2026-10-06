// js/dayRoll.js — keeps "today" correct when the app is left open past midnight.
//
// "Today" is never stored: every render derives it from the clock (the grid's
// highlighted cell, the header date badge, Upcoming and Countdown). So a window
// left open overnight keeps showing yesterday until something re-renders —
// which used to mean a manual refresh.
//
// This module watches for the calendar day to change and repaints. A timer
// fires just after local midnight (so an always-on display flips on its own),
// and because a backgrounded tab's timers are throttled or frozen — and phones
// sleep — we also re-check whenever the app is shown, focused, or restored from
// the back/forward cache, so returning to the tab shows the right day
// immediately. A check on the same day is a cheap no-op, so this costs at most
// one repaint per day, plus one when you come back after midnight.

import { todayKey } from "./utils.js";
import { getState, refresh, setView } from "./state.js";

let _dayRollKey = null;
let _dayRollTimer = null;

/** Milliseconds from now until just after the next local midnight. */
function msUntilLocalMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next - now + 1000; // +1s so we're safely past the boundary
}

/**
 * If the day has changed since the last check, repaint so the new "today" is
 * highlighted. When the user was sitting on the month that just ended, follow
 * the calendar into the new month; if they had navigated elsewhere, leave their
 * view alone and just repaint in place.
 */
function checkDayRollover() {
  const key = todayKey();
  if (key === _dayRollKey) return;
  const prev = _dayRollKey;
  _dayRollKey = key;

  const { ui } = getState();
  const [py, pm] = (prev || "").split("-").map(Number);
  const now = new Date();
  const wasOnEndedMonth = ui.year === py && ui.month === pm - 1;
  const monthChanged =
    ui.year !== now.getFullYear() || ui.month !== now.getMonth();

  if (wasOnEndedMonth && monthChanged) {
    // setView() emits, so this also repaints every subscriber.
    setView(now.getFullYear(), now.getMonth());
  } else {
    refresh();
  }
}

function scheduleDayRollover() {
  if (_dayRollTimer) clearTimeout(_dayRollTimer);
  _dayRollTimer = setTimeout(() => {
    checkDayRollover();
    scheduleDayRollover();
  }, msUntilLocalMidnight());
}

export function initDayRoll() {
  _dayRollKey = todayKey();
  scheduleDayRollover();

  // Timer throttling and device sleep mean the midnight timer can't be trusted
  // alone — re-check whenever the app comes back to the foreground.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkDayRollover();
  });
  window.addEventListener("focus", checkDayRollover);
  // iOS Safari may restore from the back/forward cache without firing
  // focus or visibilitychange.
  window.addEventListener("pageshow", checkDayRollover);
}
