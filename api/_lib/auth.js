// api/_lib/auth.js — single-login auth for the Vercel deployment.
//
// One login string, chosen by the owner, set as the CALENDAR_PASSCODE
// environment variable in the Vercel dashboard. The client sends the string
// the user typed in the `X-Calendar-Login` header on every request; we
// compare it against the env var in constant time. Match → proceed.
// Mismatch, missing header, or unset env var → 401 (fail closed).
//
// This is API-key-style auth: the secret travels with each request, always
// over HTTPS on Vercel. Changing the env var (then redeploying) instantly
// locks out every device until they log in with the new string.

import crypto from "crypto";

const LOGIN_HEADER = "x-calendar-login"; // Node lowercases header names

/** Constant-time string compare that won't throw on length mismatch. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/** Extract the submitted login from the request header, or null. */
function getSubmitted(req) {
  const raw = req.headers[LOGIN_HEADER];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v.trim() : null;
}

/** True if the request carries the correct login. */
export function isAuthed(req) {
  const expected = process.env.CALENDAR_PASSCODE;
  if (!expected || expected.length === 0) return false; // fail closed
  const submitted = getSubmitted(req);
  if (!submitted) return false;
  return safeEqual(submitted, expected);
}

/**
 * Guard for data endpoints. Returns true if the request may proceed;
 * otherwise writes a 401 and returns false.
 */
export function requireAuth(req, res) {
  if (isAuthed(req)) return true;
  res.status(401).json({ error: "incorrect or missing login" });
  return false;
}
