// api/events/index.js — POST upsert an event (body must include id).
import { requireAuth } from "../_lib/auth.js";
import { mutateState } from "../_lib/store.js";

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  const body = typeof req.body === "string" ? safeParse(req.body) : req.body;
  if (!body || !body.id) {
    return res.status(400).json({ error: "event body must include id" });
  }

  const next = await mutateState((state) => {
    state.events = state.events.filter((e) => e.id !== body.id);
    state.events.push(body);
    return state;
  });

  return res.status(200).json({ version: next.version, event: body });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
