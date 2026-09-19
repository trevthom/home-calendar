// js/app.js — entry point.
//
// Boot sequence:
//   0. If no login is present on this device, show the login overlay and
//      STOP. The calendar never renders without an identity, so one login's
//      events can't briefly flash before another's.
//   1. UI modules render synchronously from this login's localStorage cache.
//   2. initialSync() pulls /api/state for this login.
//   3. startPolling() watches /api/version every 5s (+ on focus/visibility).

import { initSidebar } from "./sidebar.js";
import { initGrid } from "./grid.js";
import { initModal } from "./modal.js";
import { initDayModal } from "./dayModal.js";
import { initUpcoming } from "./upcoming.js";
import { initCountdown } from "./countdown.js";

import { getState, getServerVersion, replaceServerData } from "./state.js";
import { initialSync, startPolling, onUnauthorized } from "./sync.js";
import { showLogin } from "./login.js";
import { getLogin, clearLogin } from "./session.js";

document.addEventListener("DOMContentLoaded", () => {
  // Gate: no identity → login screen only. Do not boot the data layer.
  if (!getLogin()) {
    showLogin();
    return;
  }

  // If the backend rejects our stored login (401 — e.g. the owner changed
  // the passcode), forget the stale string and show the login screen.
  onUnauthorized(() => {
    clearLogin();
    showLogin();
  });

  // Order is significant: modal must exist before grid (grid opens it on cell click).
  initModal();
  initDayModal();
  initGrid();
  initSidebar();
  initCountdown();
  initUpcoming();

  initialSync(getState, replaceServerData);

  startPolling({
    getLocalVersion: getServerVersion,
    onRemoteChange: replaceServerData,
  });
});
