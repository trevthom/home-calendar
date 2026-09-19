// js/modal.js — event create/edit modal logic.
// Tracks both the editing event id and the *instance date* (the specific
// occurrence the user clicked) so we can offer "delete this occurrence" vs
// "delete entire series" for recurring events.

import { $, $$, clear, el } from "./utils.js";
import {
  getState, subscribe,
  addEvent, updateEvent, deleteEvent, addEventException,
  palette,
} from "./state.js";

const modal = () => $("#modal");
const form  = () => $("#event-form");

let editingId = null;            // null = create mode
let editingInstanceDate = null;  // date of the specific occurrence being edited

/* ---------- Helpers ---------- */

function renderCalendarSelect() {
  const sel = $("#f-calendar");
  clear(sel);
  const { calendars } = getState();
  for (const c of calendars) {
    sel.append(el("option", { value: c.id }, c.name));
  }
}

function renderSwatches() {
  const wrap = $("#f-color-swatches");
  clear(wrap);
  for (const color of palette()) {
    const sw = el("button", {
      type: "button",
      class: "swatch",
      style: { "--swatch-color": color },
      dataset: { color },
      "aria-label": `Color ${color}`,
    });
    sw.addEventListener("click", () => {
      $$(".swatch", wrap).forEach((s) => s.removeAttribute("data-selected"));
      sw.setAttribute("data-selected", "true");
    });
    wrap.append(sw);
  }
}

function selectSwatch(color) {
  $$(".swatch").forEach((s) => {
    s.toggleAttribute("data-selected", s.dataset.color === color);
  });
}

function reflectAllDay() {
  const allDay = $("#f-allday").checked;
  $("#time-row").hidden = allDay;
  if (!allDay) {
    if (!$("#f-start").value) $("#f-start").value = "09:00";
    if (!$("#f-end").value)   $("#f-end").value   = "10:00";
  }
}

/* ---------- Public API ---------- */

/**
 * @param {{ mode: "create"|"edit", date?: string, event?: object }} opts
 *   `date` is the cell that was clicked (= instance date for edit).
 */
export function openModal({ mode, date, event }) {
  renderCalendarSelect();
  renderSwatches();
  hideDeleteConfirm(); // make sure form is visible after a previous confirm

  const titleEl = $("#modal-title");
  const deleteBtn = $("#delete-btn");

  if (mode === "edit" && event) {
    editingId = event.id;
    editingInstanceDate = date || event.date;
    titleEl.textContent = "Edit event";
    deleteBtn.hidden = false;

    $("#f-title").value       = event.title || "";
    $("#f-date").value        = event.date || date || "";
    $("#f-allday").checked    = !!event.allDay;
    $("#f-start").value       = event.startTime || "";
    $("#f-end").value         = event.endTime || "";
    $("#f-repeat").value      = event.repeat || "none";
    $("#f-countdown").checked = !!event.countdown;
    // Repeat count
    if (event.repeatCount && event.repeatCount > 0) {
      $("#f-repeat-end").value = "count";
      $("#f-repeat-count").value = event.repeatCount;
    } else {
      $("#f-repeat-end").value = "forever";
      $("#f-repeat-count").value = "10";
    }
    $("#repeat-count-row").hidden = !event.repeat || event.repeat === "none";
    $("#repeat-count-field").hidden = $("#f-repeat-end").value !== "count";
    $("#f-calendar").value    = event.calendarId || "";
    $("#f-location").value    = event.location || "";
    $("#f-description").value = event.description || "";
    selectSwatch(event.color || "");
  } else {
    editingId = null;
    editingInstanceDate = null;
    titleEl.textContent = "New event";
    deleteBtn.hidden = true;

    form().reset();
    $("#f-date").value = date || "";
    $("#f-repeat").value = "none";
    $("#f-repeat-end").value = "forever";
    $("#f-repeat-count").value = "10";
    $("#repeat-count-row").hidden = true;
    $("#repeat-count-field").hidden = true;
    selectSwatch("");
  }

  reflectAllDay();
  modal().hidden = false;
  setTimeout(() => $("#f-title").focus(), 50);
}

export function closeModal() {
  modal().hidden = true;
  hideDeleteConfirm();
  editingId = null;
  editingInstanceDate = null;
}

/* ---------- Delete confirmation flow ---------- */

function showDeleteConfirm() {
  if (!editingId) return;
  const ev = getState().events.find((e) => e.id === editingId);
  if (!ev) return;

  const isRecurring = ev.repeat && ev.repeat !== "none";
  const msg = $("#confirm-msg");
  const instanceBtn = $("#confirm-instance");
  const seriesBtn = $("#confirm-series");

  if (isRecurring) {
    $("#confirm-title").textContent = "Delete repeating event";
    msg.textContent = "This is a repeating event. Delete only this occurrence, or the entire series?";
    instanceBtn.hidden = false;
    seriesBtn.textContent = "Entire series";
  } else {
    $("#confirm-title").textContent = "Delete event?";
    msg.textContent = `"${ev.title || "(untitled)"}" will be removed.`;
    instanceBtn.hidden = true;
    seriesBtn.textContent = "Delete";
  }

  form().hidden = true;
  $("#delete-confirm").hidden = false;
}

function hideDeleteConfirm() {
  $("#delete-confirm").hidden = true;
  form().hidden = false;
}

/* ---------- Init ---------- */

export function initModal() {
  // Close handlers
  modal().addEventListener("click", (e) => {
    if (e.target.dataset.close !== undefined) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal().hidden) closeModal();
  });

  $("#f-allday").addEventListener("change", reflectAllDay);

  // Auto-set end time to 1 hour after start time whenever start changes
  $("#f-start").addEventListener("change", () => {
    const start = $("#f-start").value;
    if (!start) return;
    const [h, m] = start.split(":").map(Number);
    const endH = (h + 1) % 24;
    $("#f-end").value = String(endH).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  });

  // Show/hide repeat-count row when repeat changes
  function reflectRepeat() {
    const repeating = $("#f-repeat").value !== "none";
    $("#repeat-count-row").hidden = !repeating;
    reflectRepeatEnd();
  }
  function reflectRepeatEnd() {
    $("#repeat-count-field").hidden = $("#f-repeat-end").value !== "count";
  }
  $("#f-repeat").addEventListener("change", reflectRepeat);
  $("#f-repeat-end").addEventListener("change", reflectRepeatEnd);

  // Submit
  form().addEventListener("submit", (e) => {
    e.preventDefault();
    const allDay = $("#f-allday").checked;
    const selectedSwatch = $$(".swatch").find((s) => s.hasAttribute("data-selected"));
    const data = {
      title:       $("#f-title").value.trim() || "(untitled)",
      date:        $("#f-date").value,
      allDay,
      startTime:   allDay ? "" : $("#f-start").value,
      endTime:     allDay ? "" : $("#f-end").value,
      repeat:      $("#f-repeat").value,
      repeatCount: ($("#f-repeat").value !== "none" && $("#f-repeat-end").value === "count")
                     ? parseInt($("#f-repeat-count").value, 10) || 0
                     : 0,
      countdown:   $("#f-countdown").checked,
      calendarId:  $("#f-calendar").value,
      color:       selectedSwatch ? selectedSwatch.dataset.color : null,
      location:    $("#f-location").value.trim(),
      description: $("#f-description").value.trim(),
    };
    if (!data.date) return;

    if (editingId) {
      updateEvent(editingId, data);
    } else {
      addEvent(data);
    }
    closeModal();
  });

  // Delete -> open confirm
  $("#delete-btn").addEventListener("click", showDeleteConfirm);

  // Confirm panel buttons
  $("#confirm-cancel").addEventListener("click", hideDeleteConfirm);

  $("#confirm-instance").addEventListener("click", () => {
    if (editingId && editingInstanceDate) {
      addEventException(editingId, editingInstanceDate);
    }
    closeModal();
  });

  $("#confirm-series").addEventListener("click", () => {
    if (editingId) deleteEvent(editingId);
    closeModal();
  });

  // Re-render the calendar select if calendars change while modal is open
  subscribe(() => {
    if (!modal().hidden) {
      const cur = $("#f-calendar").value;
      renderCalendarSelect();
      $("#f-calendar").value = cur;
    }
  });
}
