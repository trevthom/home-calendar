// api/state.js — GET full snapshot, PUT bulk replace (used by .ics import).
import { requireAuth } from "./_lib/auth.js";
import { readState, writeState } from "./_lib/store.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  if (req.method === "GET") {
    const state = await readState();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(state);
  }

  if (req.method === "PUT") {
    const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
    if (!body || !Array.isArray(body.calendars) || !Array.isArray(body.events)) {
      return res.status(400).json({ error: "need calendars[] and events[]" });
    }
    const current = await readState();
    const next = {
      calendars: body.calendars,
      events: body.events,
      version: (current.version || 0) + 1,
    };
    await writeState(next);
    return res.status(200).json({ version: next.version });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ error: "method not allowed" });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
