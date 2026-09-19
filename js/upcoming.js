// js/upcoming.js — list of next 10 upcoming events from currently visible calendars.

import { $, clear, el, MONTHS, fromDateKey, formatTime } from "./utils.js";
import { getState, subscribe, setUpcomingCollapsed } from "./state.js";
import { getUpcoming, eventColor } from "./events.js";
import { openModal } from "./modal.js";

function renderUpcoming() {
  const list = $("#upcoming-list");
  clear(list);

  const { events, calendars, ui } = getState();

  // Reflect collapsed state in the DOM
  $("#upcoming").dataset.collapsed = ui.sidebarUpcomingCollapsed ? "true" : "false";
  $("#upcoming-toggle").setAttribute(
    "aria-expanded",
    ui.sidebarUpcomingCollapsed ? "false" : "true"
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = getUpcoming(events, calendars, today, 4);

  if (upcoming.length === 0) {
    list.append(el("li", { class: "upcoming__empty" }, "No upcoming events"));
    return;
  }

  for (const ev of upcoming) {
    const d = fromDateKey(ev.instanceDate);
    const color = eventColor(ev, calendars);

    const item = el("li", {
      class: "up-item",
      style: { "--up-color": color },
      onclick: () => openModal({ mode: "edit", event: ev, date: ev.instanceDate }),
    });

    item.append(
      el("div", { class: "up-item__date" }, [
        el("div", { class: "up-item__day" }, String(d.getDate())),
        el("div", { class: "up-item__mon" }, MONTHS[d.getMonth()].slice(0, 3)),
      ]),
      el("div", { class: "up-item__body" }, [
        el("div", { class: "up-item__title" }, ev.title || "(untitled)"),
        el(
          "div",
          { class: "up-item__meta" },
          ev.allDay
            ? "All day"
            : ev.startTime
              ? formatTime(ev.startTime) + (ev.endTime ? " – " + formatTime(ev.endTime) : "")
              : ""
        ),
      ])
    );

    list.append(item);
  }
}

export function initUpcoming() {
  $("#upcoming-toggle").addEventListener("click", () => {
    const { ui } = getState();
    setUpcomingCollapsed(!ui.sidebarUpcomingCollapsed);
  });

  renderUpcoming();
  subscribe(renderUpcoming);
}
