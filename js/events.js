// js/events.js — event logic: recurrence expansion, range queries.

import { fromDateKey, toDateKey, addDays } from "./utils.js";

/**
 * For an event with recurrence, return true if it has an instance on `dateKey`.
 * `dateKey` is "YYYY-MM-DD" local.
 */
export function eventOccursOn(ev, dateKey) {
  // Exception dates are skipped no matter what
  if (ev.exdates && ev.exdates.includes(dateKey)) return false;

  const target = fromDateKey(dateKey);
  const start = fromDateKey(ev.date);
  if (target < start) return false;
  if (ev.repeat === "none" || !ev.repeat) {
    return ev.date === dateKey;
  }
  const diffDays = Math.round((target - start) / 86400000);

  // Which occurrence number would this be? (0-based: the original date = 0)
  let instanceIndex = -1;
  switch (ev.repeat) {
    case "weekly":   if (diffDays % 7 === 0)  instanceIndex = diffDays / 7;  break;
    case "biweekly": if (diffDays % 14 === 0) instanceIndex = diffDays / 14; break;
    case "monthly":
      if (target.getDate() === start.getDate()) {
        instanceIndex = (target.getFullYear() - start.getFullYear()) * 12
                      + (target.getMonth() - start.getMonth());
      }
      break;
    case "yearly":
      if (target.getDate() === start.getDate() && target.getMonth() === start.getMonth()) {
        instanceIndex = target.getFullYear() - start.getFullYear();
      }
      break;
    default:
      return false;
  }
  if (instanceIndex < 0) return false;

  // repeatCount = 0 or absent means "forever". Otherwise, total occurrences
  // = repeatCount (the first occurrence counts as 1), so instanceIndex must
  // be < repeatCount.
  if (ev.repeatCount && ev.repeatCount > 0 && instanceIndex >= ev.repeatCount) {
    return false;
  }

  return true;
}

/** Get all event "instances" between [from, to] inclusive. */
export function expandRange(events, calendars, from, to) {
  const visibleCalIds = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  const out = [];
  let cursor = new Date(from);
  while (cursor <= to) {
    const key = toDateKey(cursor);
    for (const ev of events) {
      if (!visibleCalIds.has(ev.calendarId)) continue;
      if (eventOccursOn(ev, key)) {
        out.push({ ...ev, instanceDate: key });
      }
    }
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Group event instances by date key. */
export function groupByDate(instances) {
  const map = new Map();
  for (const inst of instances) {
    const arr = map.get(inst.instanceDate) || [];
    arr.push(inst);
    map.set(inst.instanceDate, arr);
  }
  // Sort each day's events: all-day first, then by start time
  for (const arr of map.values()) {
    arr.sort((a, b) => {
      if (a.allDay && !b.allDay) return -1;
      if (!a.allDay && b.allDay) return 1;
      return (a.startTime || "").localeCompare(b.startTime || "");
    });
  }
  return map;
}

/** Get the next N upcoming instances starting from `fromDate` (inclusive). */
export function getUpcoming(events, calendars, fromDate, count = 10) {
  // Look ahead 1 year max — more than enough for "next 10".
  const to = new Date(fromDate);
  to.setFullYear(to.getFullYear() + 1);
  const all = expandRange(events, calendars, fromDate, to);
  // Sort chronologically
  all.sort((a, b) => {
    if (a.instanceDate !== b.instanceDate)
      return a.instanceDate < b.instanceDate ? -1 : 1;
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return (a.startTime || "").localeCompare(b.startTime || "");
  });
  return all.slice(0, count);
}

/** Resolve an event's display color (override > calendar color). */
export function eventColor(ev, calendars) {
  if (ev.color) return ev.color;
  const cal = calendars.find((c) => c.id === ev.calendarId);
  return cal ? cal.color : "#888";
}

/**
 * For countdown-flagged events, compute the next occurrence date on/after
 * `fromDate` and how many whole days away it is. Non-recurring events that
 * have already passed are dropped (a countdown to the past is meaningless).
 * Recurring events always resolve to their next future occurrence.
 *
 * Returns [{ ...event, targetDate: "YYYY-MM-DD", daysUntil: N }] sorted
 * soonest-first. Visibility of the parent calendar is NOT required — a
 * countdown is an explicit per-event opt-in, so we show it regardless of
 * whether its calendar is currently toggled on.
 */
export function getCountdownEvents(events, fromDate) {
  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);
  const fromKey = toDateKey(from);

  // Scan window for recurring events: ~2 years is plenty for a countdown.
  const horizon = 366 * 2;

  const out = [];
  for (const ev of events) {
    if (!ev.countdown) continue;

    let targetKey = null;
    if (!ev.repeat || ev.repeat === "none") {
      // Single event: only counts if it's today or later.
      if (ev.date >= fromKey) targetKey = ev.date;
    } else {
      // Recurring: find the first occurrence on/after today.
      let cursor = new Date(from);
      for (let i = 0; i <= horizon; i++) {
        const key = toDateKey(cursor);
        if (eventOccursOn(ev, key)) { targetKey = key; break; }
        cursor = addDays(cursor, 1);
      }
    }
    if (!targetKey) continue;

    const target = fromDateKey(targetKey);
    const daysUntil = Math.round((target - from) / 86400000);
    out.push({ ...ev, targetDate: targetKey, daysUntil });
  }

  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}
