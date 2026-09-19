// js/grid.js — renders the month grid: header, DOW row, date cells with chips.

import {
  $, clear, el, MONTHS, DAYS_SHORT,
  buildMonthMatrix, toDateKey, todayKey, formatTime,
} from "./utils.js";
import { getState, subscribe, setView } from "./state.js";
import { expandRange, groupByDate, eventColor } from "./events.js";
import { openModal } from "./modal.js";
import { openDayModal } from "./dayModal.js";

// MAX_ROWS = total visible rows in a cell (chips + optional "+N more").
// Once a day has MAX_ROWS or more events, the last row is reserved for
// "+N more" and only MAX_ROWS - 1 chips are shown — so a cell never grows
// past 3 rows and no event is ever silently hidden behind a 3rd chip.
const MAX_ROWS = 3;

function renderGridHeader() {
  const { ui } = getState();
  $("#header-month").textContent = MONTHS[ui.month];
  $("#header-year").textContent  = ui.year;
}

function renderDowRow() {
  const row = $("#dow-row");
  clear(row);
  for (const d of DAYS_SHORT) {
    row.append(el("div", { class: "dow" }, d));
  }
}

function renderGrid() {
  const grid = $("#grid");
  clear(grid);
  const { ui, events, calendars } = getState();

  const matrix = buildMonthMatrix(ui.year, ui.month);
  const from = matrix[0];
  const to = matrix[matrix.length - 1];
  const instances = expandRange(events, calendars, from, to);
  const byDate = groupByDate(instances);

  const today = todayKey();

  for (const date of matrix) {
    const key = toDateKey(date);
    const isOtherMonth = date.getMonth() !== ui.month;
    const isToday = key === today;

    const cellClasses = ["cell"];
    if (isOtherMonth) cellClasses.push("cell--other-month");
    if (isToday) cellClasses.push("cell--today");

    const cell = el("div", {
      class: cellClasses.join(" "),
      dataset: { date: key },
    });

    cell.append(el("div", { class: "cell__num" }, String(date.getDate())));

    const eventsList = el("div", { class: "cell__events" });
    const dayEvents = byDate.get(key) || [];

    const total = dayEvents.length;
    const overflowing = total >= MAX_ROWS;
    const visible = overflowing ? dayEvents.slice(0, MAX_ROWS - 1) : dayEvents;
    const overflow = overflowing ? total - (MAX_ROWS - 1) : 0;

    for (const ev of visible) {
      const color = eventColor(ev, calendars);
      const chip = el("div", {
        class: "chip",
        style: {
          "--chip-bg": hexToSoftBg(color),
          "--chip-color": "var(--text)",
          "--chip-accent": color,
        },
        title: ev.title,
        onclick: (e) => {
          e.stopPropagation();
          openModal({ mode: "edit", event: ev, date: key });
        },
      });
      if (!ev.allDay && ev.startTime) {
        chip.append(el("span", { class: "chip__time" }, formatTime(ev.startTime)));
      }
      chip.append(document.createTextNode(ev.title || "(no title)"));
      eventsList.append(chip);
    }
    if (overflow > 0) {
      const moreBtn = el("div", {
        class: "chip chip--more",
        onclick: (e) => {
          e.stopPropagation();
          openDayModal(key);
        },
      }, `+${overflow} more`);
      eventsList.append(moreBtn);
    }

    cell.append(eventsList);
    cell.addEventListener("click", () => {
      openModal({ mode: "create", date: key });
    });
    grid.append(cell);
  }
}

/**
 * Convert "#RRGGBB" to a translucent background color suitable for chips.
 * We just lighten via alpha mixing using rgba.
 */
function hexToSoftBg(hex) {
  const m = /^#?([a-f0-9]{6})$/i.exec(hex);
  if (!m) return "var(--accent-soft)";
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.18)`;
}

export function initGrid() {
  // Wire navigation
  $("#prev-month").addEventListener("click", () => {
    const { ui } = getState();
    setView(ui.year, ui.month - 1);
  });
  $("#next-month").addEventListener("click", () => {
    const { ui } = getState();
    setView(ui.year, ui.month + 1);
  });
  $("#prev-year").addEventListener("click", () => {
    const { ui } = getState();
    setView(ui.year - 1, ui.month);
  });
  $("#next-year").addEventListener("click", () => {
    const { ui } = getState();
    setView(ui.year + 1, ui.month);
  });

  renderDowRow();
  renderGridHeader();
  renderGrid();

  subscribe(() => {
    renderGridHeader();
    renderGrid();
  });
}
