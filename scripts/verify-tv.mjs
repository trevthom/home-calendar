// scripts/verify-tv.mjs — verify the TV (/tv) layout.
//
// Checks, at several TV-like resolutions:
//   1. calendar column (incl. month/year + clock header) ≈ 75% of screen
//   2. countdown list shows at most 5 items (even with 6+ seeded countdowns)
//   3. upcoming list shows at most 3 items (even with 5+ seeded events)
//   4. countdown panel sits above the upcoming panel
//   5. nothing extends past the viewport (width or height)
//
// Seeds TV-TEST-* events through the API, then restores the original state.
// Usage: PREVIEW_URL=https://... node scripts/verify-tv.mjs
// Exit code 0 = all checks passed.

import { chromium } from "playwright";

const BASE = (process.env.PREVIEW_URL || "http://localhost:8765").replace(/\/$/, "");
const LOGIN = process.env.CALENDAR_LOGIN || "verify1";
const HDR = { "X-Calendar-Login": LOGIN, "Content-Type": "application/json" };

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

function keyOf(d) {
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dateFromToday(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return keyOf(d);
}

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: HDR, ...opts });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const VIEWPORTS = [
  [1920, 1080], // 1080p TV
  [1366, 768],  // common TV/monitor
  [1280, 720],  // 720p TV (older Smart TVs)
];

async function main() {
  // ---- seed ----
  const snap = await api("/api/state");
  const calId = snap.calendars[0].id;
  const seeded = [];
  for (let i = 1; i <= 6; i++) {
    seeded.push({
      id: `tvtest-cd-${i}`,
      title: `TVTEST Countdown ${i}`,
      date: dateFromToday(i),
      allDay: true,
      countdown: true,
      repeat: "none",
      calendarId: calId,
    });
  }
  for (let i = 1; i <= 5; i++) {
    seeded.push({
      id: `tvtest-up-${i}`,
      title: `TVTEST Upcoming ${i}`,
      date: dateFromToday(Math.floor((i - 1) / 2)),
      allDay: false,
      startTime: `0${i}:00`.slice(-5),
      countdown: false,
      repeat: "none",
      calendarId: calId,
    });
  }
  for (const ev of seeded) await api("/api/events", { method: "POST", body: JSON.stringify(ev) });

  // ---- measure ----
  const browser = await chromium.launch();
  try {
    for (const [W, H] of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      await page.goto(BASE + "/tv", { waitUntil: "domcontentloaded" });
      // tv.html renders immediately, then re-renders after first poll (~0s);
      // wait until the countdown list reflects the seeded data.
      await page
        .waitForFunction(() => document.querySelectorAll("#cdlist .cditem").length >= 5, null, { timeout: 8000 })
        .catch(() => {});

      const m = await page.evaluate(() => {
        const r = (sel) => {
          const e = document.querySelector(sel);
          return e ? e.getBoundingClientRect() : null;
        };
        const left = r("#leftcol");
        const right = r("#rightcol");
        const cal = r("#cal");
        const cd = document.querySelectorAll("#cdlist .cditem").length;
        const up = document.querySelectorAll("#uplist .cditem").length;
        const cdRect = r("#cdlist");
        const upRect = r("#uplist");
        // bottom-most visible element across both columns
        let maxBottom = 0, maxRight = 0;
        document.querySelectorAll("#shell, #cal, .panel, #hdr").forEach((e) => {
          const b = e.getBoundingClientRect();
          if (b.bottom > maxBottom) maxBottom = b.bottom;
          if (b.right > maxRight) maxRight = b.right;
        });
        return {
          innerW: window.innerWidth,
          innerH: window.innerHeight,
          scrollW: document.documentElement.scrollWidth,
          scrollH: document.documentElement.scrollHeight,
          leftW: left ? left.width : 0,
          rightW: right ? right.width : 0,
          calBottom: cal ? cal.bottom : 0,
          maxBottom,
          maxRight,
          cdCount: cd,
          upCount: up,
          cdAboveUp: cdRect && upRect ? cdRect.top < upRect.top : false,
          title: document.getElementById("title").textContent,
          clock: document.getElementById("clock").textContent,
        };
      });

      console.log(`\n=== TV viewport ${W}x${H} ===`);
      check("calendar column ≈ 75% of screen", Math.abs(m.leftW / m.innerW - 0.75) < 0.02,
        `${(100 * m.leftW / m.innerW).toFixed(1)}%`);
      check("lists column ≈ 25% of screen", Math.abs(m.rightW / m.innerW - 0.25) < 0.02,
        `${(100 * m.rightW / m.innerW).toFixed(1)}%`);
      check("countdown shows at most 5", m.cdCount <= 5, `count=${m.cdCount}`);
      check("countdown shows the capped 5 (seeded 6)", m.cdCount === 5, `count=${m.cdCount}`);
      check("upcoming shows at most 3", m.upCount <= 3, `count=${m.upCount}`);
      check("upcoming shows the capped 3 (seeded 5)", m.upCount === 3, `count=${m.upCount}`);
      check("countdown panel above upcoming panel", m.cdAboveUp);
      check("nothing extends past viewport height", m.maxBottom <= m.innerH + 1 && m.scrollH <= m.innerH + 1,
        `maxBottom=${m.maxBottom.toFixed(0)} innerH=${m.innerH} scrollH=${m.scrollH}`);
      check("nothing extends past viewport width", m.maxRight <= m.innerW + 1 && m.scrollW <= m.innerW + 1,
        `maxRight=${m.maxRight.toFixed(0)} innerW=${m.innerW} scrollW=${m.scrollW}`);
      check("month/year title rendered", /January|February|March|April|May|June|July|August|September|October|November|December/.test(m.title), m.title.trim());
      check("clock rendered", /\d{1,2}:\d{2}\s?(AM|PM)/.test(m.clock), m.clock.trim());

      await page.screenshot({ path: `/tmp/tv-${W}x${H}.png` });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ---- restore original data (verify it actually landed; retry once) ----
  for (let attempt = 1; attempt <= 2; attempt++) {
    await api("/api/state", { method: "PUT", body: JSON.stringify(snap) });
    const after = await api("/api/state");
    const leftover = after.events.filter((e) => String(e.id).startsWith("tvtest-")).length;
    if (leftover === 0) break;
    console.log(`WARN: restore attempt ${attempt} left ${leftover} test events; retrying`);
  }
  const final = await api("/api/state");
  const leftover = final.events.filter((e) => String(e.id).startsWith("tvtest-")).length;
  check("original calendar state restored", leftover === 0, `${leftover} test events remain`);
  console.log("\n(original calendar state restored)");

  console.log(failures === 0 ? "\nALL TV CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("verify-tv crashed:", e);
  process.exit(1);
});
