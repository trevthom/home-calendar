// api/version.js — GET { version }. The cheap endpoint the poll loop hits.
// Also doubles as the login-verification endpoint: a 200 means the submitted
// login is correct; a 401 means it isn't.
import { requireAuth } from "./_lib/auth.js";
import { readState } from "./_lib/store.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }
  const state = await readState();
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ version: state.version });
}
