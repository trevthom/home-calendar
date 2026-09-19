// js/countdown.js — sidebar "Countdown" section.
//
// Lists every event whose "Show countdown in sidebar" checkbox is ticked,
// with the number of days until the event (its next occurrence, for
// recurring events). Clicking an entry opens that event for editing.

import { $, clear, el, MONTHS, fromDateKey, formatTime } from "./utils.js";
import { getState, subscribe, setCountdownCollapsed } from "./state.js";
import { getCountdownEvents, eventColor } from "./events.js";
import { openModal } from "./modal.js";

/** Format the "when" line: "Aug 24, 11:00 AM-11:30 AM" or "Sep 3, All Day". */
function whenLabel(ev) {
  const d = fromDateKey(ev.targetDate);
  const mon = MONTHS[d.getMonth()].slice(0, 3);
  const day = d.getDate();
  if (ev.allDay) return `${mon} ${day}, All Day`;
  const start = formatTime(ev.startTime);
  const end = ev.endTime ? `-${formatTime(ev.endTime)}` : "";
  return `${mon} ${day}, ${start}${end}`;
}

/* ---------- Countdown "Show All" modal ---------- */

function openCountdownModal() {
  const modal = $("#countdown-modal");
  const list = $("#cd-modal-list");
  clear(list);

  const { events, calendars } = getState();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items = getCountdownEvents(events, today); // all of them, no cap

  if (items.length === 0) {
    list.append(el("li", { class: "cd-modal__empty" }, "No countdown events"));
  } else {
    for (const ev of items) {
      const color = eventColor(ev, calendars);
      const editBtn = el("button", {
        class: "cd-modal__edit",
        type: "button",
      }, "Edit");
      editBtn.addEventListener("click", () => {
        closeCountdownModal();
        openModal({ mode: "edit", event: ev, date: ev.targetDate });
      });

      const item = el("li", {
        class: "cd-modal__item",
        style: { "--cd-color": color },
      }, [
        el("div", { class: "cd-modal__count" }, [
          el("div", { class: "cd-modal__num" }, String(ev.daysUntil)),
          el("div", { class: "cd-modal__unit" }, ev.daysUntil === 1 ? "day" : "days"),
        ]),
        el("div", { class: "cd-modal__body" }, [
          el("div", { class: "cd-modal__item-title" }, ev.title || "(untitled)"),
          el("div", { class: "cd-modal__item-when" }, whenLabel(ev)),
        ]),
        editBtn,
      ]);
      list.append(item);
    }
  }

  modal.hidden = false;
}

function closeCountdownModal() {
  $("#countdown-modal").hidden = true;
}

function renderCountdown() {
  const list = $("#countdown-list");
  clear(list);

  const { events, calendars, ui } = getState();

  $("#countdown").dataset.collapsed = ui.sidebarCountdownCollapsed ? "true" : "false";
  $("#countdown-toggle").setAttribute(
    "aria-expanded",
    ui.sidebarCountdownCollapsed ? "false" : "true"
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items = getCountdownEvents(events, today).slice(0, 4);

  if (items.length === 0) {
    list.append(el("li", { class: "countdown__empty" }, "No countdowns"));
    return;
  }

  for (const ev of items) {
    const color = eventColor(ev, calendars);

    const item = el("li", {
      class: "cd-item",
      style: { "--cd-color": color },
      onclick: () => openModal({ mode: "edit", event: ev, date: ev.targetDate }),
    });

    const big = ev.daysUntil === 0 ? "0" : String(ev.daysUntil);

    item.append(
      el("div", { class: "cd-item__count" }, [
        el("div", { class: "cd-item__num" }, big),
        el("div", { class: "cd-item__unit" },
          ev.daysUntil === 1 ? "day" : "days"),
      ]),
      el("div", { class: "cd-item__body" }, [
        el("div", { class: "cd-item__title" }, ev.title || "(untitled)"),
        el("div", { class: "cd-item__when" }, whenLabel(ev)),
      ])
    );

    list.append(item);
  }
}

export function initCountdown() {
  $("#countdown-toggle").addEventListener("click", () => {
    const { ui } = getState();
    setCountdownCollapsed(!ui.sidebarCountdownCollapsed);
  });

  // "All" button opens the scrollable countdown modal
  $("#countdown-show-all").addEventListener("click", openCountdownModal);

  // Close countdown modal on overlay click, close button, or ESC
  const cdModal = $("#countdown-modal");
  cdModal.addEventListener("click", (e) => {
    if (e.target.dataset.close !== undefined) closeCountdownModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !cdModal.hidden) closeCountdownModal();
  });

  renderCountdown();
  subscribe(renderCountdown);
}
