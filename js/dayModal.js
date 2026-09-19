// js/dayModal.js — day detail modal: shown when "+N more" or a day's
// number area is clicked. Lists every event on that day with no truncation
// so a packed day stays browsable.

import { $, clear, el, fromDateKey, formatTime, MONTHS, DAYS_FULL } from "./utils.js";
import { getState, subscribe } from "./state.js";
import { expandRange, eventColor } from "./events.js";
import { openModal } from "./modal.js";

const dayModal = () => $("#day-modal");

let currentDateKey = null;

function renderEventsForDay(dateKey) {
  const list = $("#day-modal-list");
  clear(list);

  const { events, calendars } = getState();
  const date = fromDateKey(dateKey);
  const instances = expandRange(events, calendars, date, date);

  // Sort: all-day first, then by start time
  instances.sort((a, b) => {
    if (a.allDay && !b.allDay) return -1;
    if (!a.allDay && b.allDay) return 1;
    return (a.startTime || "").localeCompare(b.startTime || "");
  });

  if (instances.length === 0) {
    list.append(el("li", { class: "day-modal__empty" }, "No events"));
    return;
  }

  for (const ev of instances) {
    const color = eventColor(ev, calendars);
    const item = el("li", {
      class: "day-modal__item",
      style: { "--up-color": color },
      onclick: () => {
        closeDayModal();
        openModal({ mode: "edit", event: ev, date: dateKey });
      },
    });

    const time = ev.allDay
      ? "All day"
      : ev.startTime
        ? formatTime(ev.startTime) + (ev.endTime ? " – " + formatTime(ev.endTime) : "")
        : "";

    item.append(
      el("div", { class: "day-modal__time" }, time),
      el("div", { class: "day-modal__title" }, ev.title || "(untitled)")
    );

    if (ev.location) {
      item.append(el("div", { class: "day-modal__loc" }, ev.location));
    }

    list.append(item);
  }
}

function renderDayModalHeader(dateKey) {
  const d = fromDateKey(dateKey);
  $("#day-modal-dow").textContent = DAYS_FULL[d.getDay()];
  $("#day-modal-title").textContent = String(d.getDate());
  $("#day-modal-mon").textContent = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function openDayModal(dateKey) {
  currentDateKey = dateKey;
  renderDayModalHeader(dateKey);
  renderEventsForDay(dateKey);
  dayModal().hidden = false;
}

export function closeDayModal() {
  dayModal().hidden = true;
  currentDateKey = null;
}

export function initDayModal() {
  // Backdrop / close button
  dayModal().addEventListener("click", (e) => {
    if (e.target.dataset.closeDay !== undefined) closeDayModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !dayModal().hidden) closeDayModal();
  });

  // "+ Add event" button
  $("#day-modal-add").addEventListener("click", () => {
    const date = currentDateKey;
    closeDayModal();
    if (date) openModal({ mode: "create", date });
  });

  // Re-render the list if state changes while the modal is open (e.g. an
  // event was deleted from a different surface). Header doesn't depend on
  // state.
  subscribe(() => {
    if (!dayModal().hidden && currentDateKey) {
      renderEventsForDay(currentDateKey);
    }
  });
}
