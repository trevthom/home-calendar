// js/grid.js — renders the month grid: header, DOW row, date cells with chips.

import {
  $, clear, el, MONTHS, DAYS_SHORT,
  buildMonthMatrix, toDateKey, todayKey, formatTime,
} from "./utils.js";
import { getState, subscribe, setView } from "./state.js";
import { expandRange, groupByDate, eventColor } from "./events.js";
import { openModal } from "./modal.js";
import { openEventDetails } from "./eventDetails.js";
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

  // Header badge (top-right): today's date number.
  const todayBadge = $("#header-today");
  if (todayBadge) todayBadge.textContent = String(new Date().getDate());
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
          openEventDetails({ event: ev, date: key });
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
    attachDayPeek(cell, key);
    grid.append(cell);
  }
}

let dayMenu = null; // the open right-click menu, if any

function closeDayMenu() {
  if (!dayMenu) return;
  dayMenu.remove();
  dayMenu = null;
  document.removeEventListener("pointerdown", onOutsidePress, true);
  document.removeEventListener("keydown", onMenuKey, true);
  window.removeEventListener("resize", closeDayMenu);
  window.removeEventListener("blur", closeDayMenu);
  document.removeEventListener("scroll", closeDayMenu, true);
}
function onOutsidePress(e) {
  if (dayMenu && !dayMenu.contains(e.target)) closeDayMenu();
}
function onMenuKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation(); // close the menu only, not a drawer behind it
    closeDayMenu();
  }
}

/** Small right-click menu at (x, y) with one item: "See all events". */
function showDayMenu(x, y, key) {
  closeDayMenu();
  const item = el("button", {
    type: "button",
    class: "ctx-menu__item",
    role: "menuitem",
    onclick: () => {
      closeDayMenu();
      openDayModal(key);
    },
  }, "See all events");
  dayMenu = el("div", { class: "ctx-menu", role: "menu" }, item);
  document.body.append(dayMenu);

  // Keep the menu inside the viewport.
  const { width, height } = dayMenu.getBoundingClientRect();
  dayMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - width - 4)) + "px";
  dayMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - height - 4)) + "px";

  document.addEventListener("pointerdown", onOutsidePress, true);
  document.addEventListener("keydown", onMenuKey, true);
  window.addEventListener("resize", closeDayMenu);
  window.addEventListener("blur", closeDayMenu);
  document.addEventListener("scroll", closeDayMenu, true);
  item.focus();
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10; // px a finger may drift before it counts as a scroll

/**
 * Show the full day list for a cell: a right-click menu on desktop, or
 * press-and-hold on touch. Works anywhere in the cell, chips included.
 */
function attachDayPeek(cell, key) {
  let lastPointerType = "mouse";
  cell.addEventListener("pointerdown", (e) => { lastPointerType = e.pointerType; }, true);

  cell.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // no browser menu; also stops the touch callout
    // A touch long-press can also fire contextmenu; the timer below handles it.
    if (lastPointerType === "touch") return;
    showDayMenu(e.clientX, e.clientY, key);
  });

  let timer = null;
  let startX = 0;
  let startY = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };

  cell.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch") return;
    startX = e.clientX;
    startY = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      openDayModal(key);
      swallowNextClick();
    }, LONG_PRESS_MS);
  });
  cell.addEventListener("pointermove", (e) => {
    if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_SLOP) cancel();
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    cell.addEventListener(type, cancel);
  }
}

/**
 * Lifting the finger after a long press fires a click. It must not add an
 * event, open one, or close the day list that just opened (the list's
 * backdrop sits under the finger). Drop that one click.
 */
function swallowNextClick() {
  const stop = (e) => {
    e.stopPropagation();
    e.preventDefault();
    off();
  };
  const off = () => {
    clearTimeout(expire);
    document.removeEventListener("click", stop, true);
  };
  const expire = setTimeout(off, 1500); // finger never lifted as a click
  document.addEventListener("click", stop, true);
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
  // Clicking the boxed today-date in the header snaps the view back to the
  // current month.
  $("#header-today").addEventListener("click", () => {
    const now = new Date();
    setView(now.getFullYear(), now.getMonth());
  });

  renderDowRow();
  renderGridHeader();
  renderGrid();

  subscribe(() => {
    renderGridHeader();
    renderGrid();
  });
}
