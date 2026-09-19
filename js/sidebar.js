// js/sidebar.js — calendar list (collapsible), theme toggle, import/export.

import { $, clear, el } from "./utils.js";
import {
  getState, subscribe,
  addCalendar, deleteCalendar, toggleCalendarVisibility,
  setCalendarsCollapsed, replaceData,
} from "./state.js";
import { loadTheme, saveTheme } from "./storage.js";
import { downloadICS, importICS } from "./ics.js";
import { clearLogin } from "./session.js";

/* ---------- Theme ---------- */

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  saveTheme(theme);
}

function initTheme() {
  applyTheme(loadTheme());
  $("#theme-toggle").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });
}

/* ---------- Calendar list ---------- */

function renderCalendarList() {
  const list = $("#cal-list-items");
  clear(list);

  const { calendars, ui } = getState();
  $("#cal-list").dataset.collapsed = ui.sidebarCalendarsCollapsed ? "true" : "false";
  $("#cal-list-toggle").setAttribute(
    "aria-expanded",
    ui.sidebarCalendarsCollapsed ? "false" : "true"
  );

  for (const cal of calendars) {
    const item = el("li", {
      class: "cal-item",
      dataset: { checked: cal.visible ? "true" : "false" },
      style: { "--cal-color": cal.color },
    });
    const check = el("span", { class: "cal-item__check", "aria-hidden": "true" });
    const name = el("span", { class: "cal-item__name" }, cal.name);
    const del = el("button", {
      class: "cal-item__delete",
      title: "Delete calendar",
      "aria-label": `Delete ${cal.name}`,
    }, "×");

    item.addEventListener("click", (e) => {
      if (e.target === del) return;
      toggleCalendarVisibility(cal.id);
    });
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete the "${cal.name}" calendar and all its events?`)) {
        deleteCalendar(cal.id);
      }
    });

    item.append(check, name, del);
    list.append(item);
  }
}

function initCalendarList() {
  // Toggle expand/collapse — clicking the title area toggles
  $("#cal-list-toggle").addEventListener("click", () => {
    const { ui } = getState();
    setCalendarsCollapsed(!ui.sidebarCalendarsCollapsed);
  });

  $("#cal-add-btn").addEventListener("click", () => {
    const name = prompt("Name for the new calendar:");
    if (!name) return;
    const palette = ["#c84a31","#c98817","#7e8c3c","#2f7a78","#3e4d8c","#7a3d6b","#4a4a4a"];
    const color = palette[getState().calendars.length % palette.length];
    addCalendar(name.trim(), color);
  });

  renderCalendarList();
  subscribe(renderCalendarList);
}

/* ---------- Import / Export ---------- */

function initImportExport() {
  $("#export-btn").addEventListener("click", () => {
    downloadICS(getState());
  });

  $("#import-btn").addEventListener("click", () => {
    $("#import-file").click();
  });

  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("Importing will replace all current events. Continue?")) {
      e.target.value = "";
      return;
    }
    const text = await file.text();
    try {
      const data = importICS(text);
      replaceData(data);
    } catch (err) {
      alert("Could not import .ics file: " + err.message);
    } finally {
      e.target.value = "";
    }
  });
}

/* ---------- Drawer (hamburger → slide-out sidebar) ---------- */

function initDrawer() {
  const sidebar = $("#sidebar");
  const backdrop = $("#sidebar-backdrop");
  const toggle = $("#sidebar-toggle");

  function setOpen(open) {
    sidebar.dataset.open = open ? "true" : "false";
    backdrop.dataset.open = open ? "true" : "false";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    // `hidden` keeps the backdrop out of the tab order entirely when closed.
    // We toggle it AFTER the close transition so the fade-out is visible.
    if (open) {
      backdrop.removeAttribute("hidden");
    } else {
      // Wait for the opacity transition before hiding from the a11y tree
      setTimeout(() => {
        if (sidebar.dataset.open !== "true") backdrop.setAttribute("hidden", "");
      }, 300);
    }
  }

  toggle.addEventListener("click", () => {
    const isOpen = sidebar.dataset.open === "true";
    setOpen(!isOpen);
  });
  backdrop.addEventListener("click", () => setOpen(false));

  document.addEventListener("keydown", (e) => {
    // Only react to ESC if drawer is open AND no modal is on top of it.
    if (e.key !== "Escape") return;
    if (sidebar.dataset.open !== "true") return;
    const eventModalOpen = !$("#modal").hasAttribute("hidden");
    const dayModalOpen = !$("#day-modal").hasAttribute("hidden");
    if (eventModalOpen || dayModalOpen) return;
    setOpen(false);
  });

  // Start closed regardless of any stale DOM state from hot reloads.
  setOpen(false);
}

/* ---------- Logout ---------- */

function initLogout() {
  $("#logout-btn").addEventListener("click", () => {
    if (!confirm("Log out on this device?")) return;
    clearLogin();
    window.location.reload();
  });
}

/* ---------- Init ---------- */

export function initSidebar() {
  initDrawer();
  initTheme();
  initCalendarList();
  initImportExport();
  initLogout();
}
