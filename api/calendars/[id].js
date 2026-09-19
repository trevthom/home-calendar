// api/calendars/[id].js — PATCH partial update, DELETE remove (cascades to
// events with that calendarId, mirroring the desktop server and state.js).
import { requireAuth } from "../_lib/auth.js";
import { mutateState } from "../_lib/store.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "missing id" });

  if (req.method === "PATCH") {
    const patch = typeof req.body === "string" ? safeParse(req.body) : req.body;
    let found = false;
    let merged = null;
    const next = await mutateState((state) => {
      state.calendars = state.calendars.map((c) => {
        if (c.id !== id) return c;
        found = true;
        merged = { ...c, ...(patch || {}), id };
        return merged;
      });
      return state;
    });
    if (!found) return res.status(404).json({ error: "calendar not found" });
    return res.status(200).json({ version: next.version, calendar: merged });
  }

  if (req.method === "DELETE") {
    let removed = false;
    const next = await mutateState((state) => {
      const before = state.calendars.length;
      state.calendars = state.calendars.filter((c) => c.id !== id);
      removed = state.calendars.length !== before;
      state.events = state.events.filter((e) => e.calendarId !== id);
      return state;
    });
    if (!removed) return res.status(404).json({ error: "calendar not found" });
    return res.status(200).json({ version: next.version });
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "method not allowed" });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
