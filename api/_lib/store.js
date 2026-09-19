// api/_lib/store.js — persistence for the Vercel deployment, backed by
// Upstash Redis (provisioned via the Vercel Marketplace integration).
//
// ONE calendar, ONE key. The whole calendar is a single JSON document; the
// version counter gives cheap-poll semantics (clients hit /api/version and
// only refetch /api/state when it moved).

import { Redis } from "@upstash/redis";

const KEY = "calendar:state:v1";
const EMPTY = { calendars: [], events: [], version: 0 };

let _redis = null;
function redis() {
  if (_redis) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    _redis = new Redis({ url, token });
  } else {
    _redis = Redis.fromEnv();
  }
  return _redis;
}

/** Read the full state document. Fresh EMPTY if nothing stored. */
export async function readState() {
  const data = await redis().get(KEY);
  if (!data) return { ...EMPTY };
  const obj = typeof data === "string" ? JSON.parse(data) : data;
  return {
    calendars: Array.isArray(obj.calendars) ? obj.calendars : [],
    events: Array.isArray(obj.events) ? obj.events : [],
    version: Number.isInteger(obj.version) ? obj.version : 0,
  };
}

/** Write the full state document. */
export async function writeState(state) {
  await redis().set(KEY, JSON.stringify(state));
  return state;
}

/** Read–modify–write helper: mutate, bump version, persist. */
export async function mutateState(mutator) {
  const state = await readState();
  const next = mutator(state) || state;
  next.version = (next.version || 0) + 1;
  await writeState(next);
  return next;
}

export { EMPTY };
