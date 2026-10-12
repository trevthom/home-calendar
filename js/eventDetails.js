// js/eventDetails.js — read-only event details modal. Clicking an event
// opens this first; its "Edit" button hands off to the edit modal in modal.js.

import { $, clear, el, fromDateKey, formatTime, MONTHS, DAYS_FULL } from "./utils.js";
import { getState } from "./state.js";
import { eventColor } from "./events.js";
import { openModal } from "./modal.js";

const detailsModal = () => $("#details-modal");

const REPEAT_LABELS = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
  yearly: "Yearly",
};

let current = null; // { event, date } for the event being shown

function dateLabel(dateKey) {
  const d = fromDateKey(dateKey);
  return `${DAYS_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function timeLabel(ev) {
  if (ev.allDay) return "All day";
  if (!ev.startTime) return "";
  return formatTime(ev.startTime) + (ev.endTime ? " – " + formatTime(ev.endTime) : "");
}

function repeatLabel(ev) {
  const base = REPEAT_LABELS[ev.repeat];
  if (!base) return "";
  return ev.repeatCount > 0 ? `${base}, ${ev.repeatCount} times` : base;
}

function row(label, value) {
  return el("div", { class: "details__row" }, [
    el("div", { class: "details__label" }, label),
    el("div", { class: "details__value" }, value),
  ]);
}

/**
 * @param {{ event: object, date: string }} opts
 *   `date` is the instance date the user clicked.
 */
export function openEventDetails({ event, date }) {
  const { calendars } = getState();
  current = { event, date: date || event.date };

  const body = $("#details-body");
  clear(body);

  detailsModal().querySelector(".modal__panel").style.setProperty(
    "--details-color", eventColor(event, calendars)
  );
  $("#details-title").textContent = event.title || "(untitled)";

  const time = timeLabel(event);
  body.append(row("When", [dateLabel(current.date), time && el("div", {}, time)]));

  const repeat = repeatLabel(event);
  if (repeat) body.append(row("Repeats", repeat));

  const cal = calendars.find((c) => c.id === event.calendarId);
  if (cal) body.append(row("Calendar", cal.name));
  if (event.location) body.append(row("Location", event.location));
  if (event.description) {
    body.append(row("Notes", el("div", { class: "details__notes" }, event.description)));
  }

  detailsModal().hidden = false;
  setTimeout(() => $("#details-edit").focus(), 50);
}

export function closeEventDetails() {
  detailsModal().hidden = true;
  current = null;
}

export function initEventDetails() {
  detailsModal().addEventListener("click", (e) => {
    if (e.target.dataset.closeDetails !== undefined) closeEventDetails();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !detailsModal().hidden) closeEventDetails();
  });

  $("#details-edit").addEventListener("click", () => {
    if (!current) return;
    const { event, date } = current;
    closeEventDetails();
    openModal({ mode: "edit", event, date });
  });
}
