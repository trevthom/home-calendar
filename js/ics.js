// js/ics.js — RFC 5545 iCalendar import/export (subset sufficient for round-tripping).

import { uid, fromDateKey } from "./utils.js";

/* ============= EXPORT ============= */

const PRODID = "-//Calendar App//EN";

function pad(n) { return String(n).padStart(2, "0"); }

function fmtDate(key) {
  // "YYYY-MM-DD" -> "YYYYMMDD"
  return key.replace(/-/g, "");
}

function fmtDateTime(key, time) {
  const [h, m] = (time || "00:00").split(":").map(Number);
  return `${fmtDate(key)}T${pad(h)}${pad(m)}00`;
}

function escapeText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function rrule(repeat) {
  switch (repeat) {
    case "weekly":   return "RRULE:FREQ=WEEKLY";
    case "biweekly": return "RRULE:FREQ=WEEKLY;INTERVAL=2";
    case "monthly":  return "RRULE:FREQ=MONTHLY";
    case "yearly":   return "RRULE:FREQ=YEARLY";
    default: return null;
  }
}

function buildEvent(ev, calendars) {
  const lines = ["BEGIN:VEVENT"];
  lines.push(`UID:${ev.id}@calendar-app`);
  lines.push(`DTSTAMP:${fmtDateTime(ev.date, "00:00")}Z`);

  if (ev.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(ev.date)}`);
    // DTEND for all-day events is exclusive; +1 day
    const end = new Date(fromDateKey(ev.date));
    end.setDate(end.getDate() + 1);
    const endKey = `${end.getFullYear()}-${pad(end.getMonth()+1)}-${pad(end.getDate())}`;
    lines.push(`DTEND;VALUE=DATE:${fmtDate(endKey)}`);
  } else {
    lines.push(`DTSTART:${fmtDateTime(ev.date, ev.startTime)}`);
    if (ev.endTime) lines.push(`DTEND:${fmtDateTime(ev.date, ev.endTime)}`);
  }

  lines.push(`SUMMARY:${escapeText(ev.title)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location)    lines.push(`LOCATION:${escapeText(ev.location)}`);

  const cal = calendars.find((c) => c.id === ev.calendarId);
  if (cal) lines.push(`CATEGORIES:${escapeText(cal.name)}`);
  if (ev.color) lines.push(`X-COLOR:${ev.color}`);
  if (ev.countdown) lines.push(`X-COUNTDOWN:TRUE`);
  if (ev.repeatCount && ev.repeatCount > 0) lines.push(`X-REPEAT-COUNT:${ev.repeatCount}`);

  const r = rrule(ev.repeat);
  if (r) lines.push(r);

  // Exception dates (skipped occurrences) — emit as DATE values
  if (ev.exdates && ev.exdates.length) {
    const dates = ev.exdates.map(fmtDate).join(",");
    lines.push(`EXDATE;VALUE=DATE:${dates}`);
  }

  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

export function exportICS(state) {
  const { calendars, events } = state;
  const out = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
  ];
  // Embed calendar metadata as X-properties so we can round-trip
  for (const c of calendars) {
    out.push(`X-CALENDAR:${c.id};${escapeText(c.name)};${c.color};${c.visible ? 1 : 0}`);
  }
  for (const ev of events) {
    out.push(buildEvent(ev, calendars));
  }
  out.push("END:VCALENDAR");
  return out.join("\r\n");
}

/* ============= IMPORT ============= */

function unfold(text) {
  // RFC 5545 line folding: a line beginning with space continues the previous
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
}

function unescapeText(s) {
  return String(s)
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseDateValue(value, params) {
  // VALUE=DATE -> "YYYYMMDD" (all-day)
  // Otherwise -> "YYYYMMDDTHHMMSS" maybe with Z
  const isDate = /VALUE=DATE/i.test(params);
  if (isDate || value.length === 8) {
    return {
      date: `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`,
      time: null,
      allDay: true,
    };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/);
  if (!m) return null;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
    allDay: false,
  };
}

function parseRRule(value) {
  const parts = Object.fromEntries(
    value.split(";").map((p) => p.split("=").map(decodeURIComponent))
  );
  const freq = (parts.FREQ || "").toUpperCase();
  const interval = parseInt(parts.INTERVAL || "1", 10);
  if (freq === "WEEKLY" && interval === 2) return "biweekly";
  if (freq === "WEEKLY") return "weekly";
  if (freq === "MONTHLY") return "monthly";
  if (freq === "YEARLY") return "yearly";
  return "none";
}

export function importICS(text) {
  const unfolded = unfold(text.replace(/\r\n/g, "\n"));
  const lines = unfolded.split("\n");

  const calendars = [];
  const events = [];
  let cur = null;

  for (const raw of lines) {
    if (!raw) continue;
    const line = raw.trim();

    if (line.startsWith("X-CALENDAR:")) {
      // X-CALENDAR:id;name;color;visible
      const parts = line.slice(11).split(";");
      if (parts.length >= 3) {
        calendars.push({
          id: parts[0],
          name: unescapeText(parts[1]),
          color: parts[2],
          visible: parts[3] !== "0",
        });
      }
      continue;
    }

    if (line === "BEGIN:VEVENT") {
      cur = {
        id: uid(),
        title: "",
        date: "",
        allDay: false,
        startTime: "",
        endTime: "",
        repeat: "none",
        countdown: false,
        repeatCount: 0,
        description: "",
        location: "",
        calendarId: null,
        color: null,
        exdates: [],
      };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur && cur.date) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    // Split "PROPERTY;PARAMS:VALUE"
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [propName, ...params] = head.split(";");
    const paramStr = params.join(";");
    const prop = propName.toUpperCase();

    switch (prop) {
      case "SUMMARY":      cur.title = unescapeText(value); break;
      case "DESCRIPTION":  cur.description = unescapeText(value); break;
      case "LOCATION":     cur.location = unescapeText(value); break;
      case "UID":          cur.id = value; break;
      case "CATEGORIES": {
        const name = unescapeText(value);
        cur._categoryName = name;
        break;
      }
      case "X-COLOR":      cur.color = value; break;
      case "X-COUNTDOWN":  cur.countdown = /^true$/i.test(value.trim()); break;
      case "X-REPEAT-COUNT": cur.repeatCount = parseInt(value.trim(), 10) || 0; break;
      case "RRULE":        cur.repeat = parseRRule(value); break;
      case "EXDATE": {
        // Multiple comma-separated dates allowed in one EXDATE line
        for (const v of value.split(",")) {
          const parsed = parseDateValue(v.trim(), paramStr);
          if (parsed) cur.exdates.push(parsed.date);
        }
        break;
      }
      case "DTSTART": {
        const parsed = parseDateValue(value, paramStr);
        if (parsed) {
          cur.date = parsed.date;
          cur.allDay = parsed.allDay;
          if (!parsed.allDay) cur.startTime = parsed.time;
        }
        break;
      }
      case "DTEND": {
        const parsed = parseDateValue(value, paramStr);
        if (parsed && !parsed.allDay) cur.endTime = parsed.time;
        break;
      }
      default: break;
    }
  }

  // Resolve calendar references for events that came in with CATEGORIES
  // but without an X-CALENDAR list. Create calendars as needed.
  const calendarsByName = new Map(calendars.map((c) => [c.name, c]));
  const fallbackPalette = ["#c84a31","#3e4d8c","#7e8c3c","#c98817","#2f7a78","#7a3d6b"];
  let paletteIdx = 0;

  for (const ev of events) {
    const name = ev._categoryName || "Imported";
    let cal = calendarsByName.get(name);
    if (!cal) {
      cal = {
        id: uid(),
        name,
        color: fallbackPalette[paletteIdx++ % fallbackPalette.length],
        visible: true,
      };
      calendars.push(cal);
      calendarsByName.set(name, cal);
    }
    ev.calendarId = cal.id;
    delete ev._categoryName;
  }

  return { calendars, events };
}

/** Helper used by the export button. */
export function downloadICS(state) {
  const blob = new Blob([exportICS(state)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "calendar.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
