// js/login.js — login overlay.
//
// The user types a login (1–50 alphanumeric characters). Each distinct login
// is a completely separate calendar. There's no password — the login string
// is the key. A "Stay logged in on this device" checkbox controls whether the
// login persists after the browser closes (see session.js).
//
// On submit we store the login via session.js and reload, so the whole app
// boots cleanly with the identity in place.

import { isValidLogin, setLogin } from "./session.js";

let _shown = false;

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "login";
  overlay.id = "login-overlay";
  overlay.innerHTML = `
    <div class="login__panel" role="dialog" aria-modal="true" aria-labelledby="login-title">
      <h1 class="login__title" id="login-title">Calendar</h1>
      <p class="login__sub">Enter your login</p>
      <form class="login__form" id="login-form" novalidate>
        <input
          class="login__input"
          id="login-input"
          type="text"
          inputmode="text"
          autocomplete="username"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          maxlength="50"
          aria-label="Login"
          placeholder="Your login"
        />
        <label class="login__remember">
          <input type="checkbox" id="login-remember" />
          <span>Stay logged in on this device</span>
        </label>
        <button class="login__btn" type="submit" id="login-btn">Log in</button>
        <p class="login__error" id="login-error" hidden></p>
      </form>
      <p class="login__hint">
        Enter the calendar's login to unlock it on this device. It's the
        string set by the calendar's owner — same one on every device.
      </p>
    </div>
  `;
  return overlay;
}

/**
 * Show the login overlay. Idempotent. On a valid submit, stores the login
 * and reloads so app boot runs with the identity present.
 */
export function showLogin() {
  if (_shown) return;
  _shown = true;

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  const form = overlay.querySelector("#login-form");
  const input = overlay.querySelector("#login-input");
  const remember = overlay.querySelector("#login-remember");
  const btn = overlay.querySelector("#login-btn");
  const error = overlay.querySelector("#login-error");

  setTimeout(() => input.focus(), 50);

  function showError(msg) {
    error.textContent = msg;
    error.removeAttribute("hidden");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const login = input.value.trim();

    if (!login) {
      showError("Please enter a login.");
      input.focus();
      return;
    }
    if (!isValidLogin(login)) {
      showError("Use only letters and numbers (up to 50 characters).");
      input.focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = "Checking…";
    error.setAttribute("hidden", "");

    // Verify against the backend BEFORE storing, so a typo shows
    // "Incorrect login" here rather than a confusing 401 loop after
    // reload. /api/version is the cheapest authenticated endpoint.
    // If the backend is unreachable (standalone file:// use, or the
    // server is down), we can't verify — accept locally and proceed,
    // matching the app's offline-tolerant behavior everywhere else.
    let verdict = "ok";
    try {
      const res = await fetch("/api/version", {
        headers: { "X-Calendar-Login": login },
        credentials: "same-origin",
      });
      if (res.status === 401) verdict = "wrong";
      else if (!res.ok) verdict = "ok"; // server hiccup ≠ wrong login
    } catch {
      verdict = "offline"; // no backend reachable; standalone mode
    }

    if (verdict === "wrong") {
      btn.disabled = false;
      btn.textContent = "Log in";
      showError("Incorrect login. Try again.");
      input.value = "";
      input.focus();
      return;
    }

    const ok = setLogin(login, remember.checked);
    if (!ok) {
      btn.disabled = false;
      btn.textContent = "Log in";
      showError("Could not save your login on this device.");
      return;
    }

    btn.textContent = "Loading…";
    // Reload so the app re-boots with the login active.
    window.location.reload();
  });
}
