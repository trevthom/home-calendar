// js/session.js — who is logged in on THIS device, right now.
//
// The login string is the account key: a different login = a completely
// separate calendar. There is no password; the login string itself is the
// secret (choose a non-obvious one). Validation: 1–50 alphanumeric chars.
//
// "Stay logged in on this device":
//   - checked   → the login is written to BOTH localStorage (survives the
//                 browser closing) and sessionStorage.
//   - unchecked → the login is written to sessionStorage ONLY, which the
//                 browser clears when it's fully closed → auto sign-out.
//
// Manual logout clears both. On boot we prefer a remembered (localStorage)
// login, then fall back to a session (sessionStorage) one.

const LS_KEY = "calendar-app:login";        // remembered login (persistent)
const SS_KEY = "calendar-app:login:session"; // this-session-only login

const MAX_LEN = 50;
const VALID = /^[A-Za-z0-9]{1,50}$/;

/** True if `s` is a legal login (1–50 alphanumeric characters). */
export function isValidLogin(s) {
  return typeof s === "string" && VALID.test(s);
}

/** The current login for this device, or null if not logged in. */
export function getLogin() {
  try {
    const remembered = localStorage.getItem(LS_KEY);
    if (remembered && isValidLogin(remembered)) return remembered;
  } catch {}
  try {
    const session = sessionStorage.getItem(SS_KEY);
    if (session && isValidLogin(session)) return session;
  } catch {}
  return null;
}

/** True if the current login was stored with "stay logged in". */
export function isRemembered() {
  try {
    return !!localStorage.getItem(LS_KEY);
  } catch {
    return false;
  }
}

/**
 * Record a successful login. `remember` controls persistence.
 * Returns false if the login string is invalid (caller should not proceed).
 */
export function setLogin(login, remember) {
  if (!isValidLogin(login)) return false;
  try {
    // sessionStorage always holds the active login for this tab session.
    sessionStorage.setItem(SS_KEY, login);
    if (remember) {
      localStorage.setItem(LS_KEY, login);
    } else {
      // Not remembering: make sure no stale persistent login lingers.
      localStorage.removeItem(LS_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/** Manual logout — forget the login everywhere on this device. */
export function clearLogin() {
  try { localStorage.removeItem(LS_KEY); } catch {}
  try { sessionStorage.removeItem(SS_KEY); } catch {}
}

export { MAX_LEN };
