// api/events/[id].js — PATCH partial update, DELETE remove (one event).
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
      state.events = state.events.map((e) => {
        if (e.id !== id) return e;
        found = true;
        merged = { ...e, ...(patch || {}), id };
        return merged;
      });
      return state;
    });
    if (!found) return res.status(404).json({ error: "event not found" });
    return res.status(200).json({ version: next.version, event: merged });
  }

  if (req.method === "DELETE") {
    let removed = false;
    const next = await mutateState((state) => {
      const before = state.events.length;
      state.events = state.events.filter((e) => e.id !== id);
      removed = state.events.length !== before;
      return state;
    });
    if (!removed) return res.status(404).json({ error: "event not found" });
    return res.status(200).json({ version: next.version });
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "method not allowed" });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
