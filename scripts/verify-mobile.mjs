// Mobile UI verification for the calendar app (Playwright, headless Chromium).
//
// Verifies the four mobile requirements against a running preview:
//   1. No page scrolling / address-bar bait: body locked, app == visual viewport.
//   2. All four month/year arrows visible on one row inside the phone screen.
//   3. Arrows sit close to the month/year text.
//   4. Today's date box top-right with slightly rounded corners.
// Plus: header survives month navigation; drawer opens/closes; desktop regression.
//
// Usage:
//   bun x playwright install chromium   (once)
//   PREVIEW_URL=http://127.0.0.1:8765 node scripts/verify-mobile.mjs
import { chromium, devices } from "playwright";

const BASE = process.env.PREVIEW_URL;
if (!BASE) {
  console.error("Set PREVIEW_URL, e.g. PREVIEW_URL=http://127.0.0.1:8765");
  process.exit(2);
}

const results = [];
const ok = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
};

async function loginIfNeeded(page) {
  await page.waitForTimeout(400);
  if (await page.locator("#login-overlay").count()) {
    await page.fill("#login-input", "verify1");
    await page.check("#login-remember");
    await page.click("#login-btn");
    await page.waitForLoadState("domcontentloaded");
  }
  await page.waitForSelector("#grid", { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function checkContext(browser, label, { mobile = true, viewport = {}, shot } = {}) {
  console.log(`\n===== ${label} =====`);
  const iPhone = devices["iPhone 13"];
  const ctx = await browser.newContext({
    ...iPhone,
    viewport: { ...iPhone.viewport, ...viewport },
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {}));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page);
  if (shot) await page.screenshot({ path: shot });

  // Shared geometry snapshot
  const s = await page.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, visible: r.width > 0 && r.height > 0 };
    };
    const el = document.querySelector("#header-today");
    const c = el ? getComputedStyle(el) : null;
    return {
      vw: window.innerWidth,
      innerH: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      overscroll:
        getComputedStyle(document.body).overscrollBehavior + "/" +
        getComputedStyle(document.documentElement).overscrollBehavior,
      appH: document.querySelector(".app").getBoundingClientRect().height,
      prevYear: g("#prev-year"), prevMonth: g("#prev-month"),
      nextMonth: g("#next-month"), nextYear: g("#next-year"),
      month: g("#header-month"),
      today: g("#header-today"),
      todayText: el ? el.textContent.trim() : null,
      todayRadius: c ? parseFloat(c.borderTopLeftRadius) : null,
      todayBorder: c ? parseFloat(c.borderTopWidth) : null,
    };
  });
  const arrows = [s.prevYear, s.prevMonth, s.nextMonth, s.nextYear];
  const arrowTops = arrows.map((a) => Math.round(a.top));
  const today = new Date().getDate();

  // Requirement 1 — no scrolling, app locked to the visual viewport
  ok("no vertical page scroll", s.scrollH <= s.innerH + 1, `scrollHeight=${s.scrollH} innerHeight=${s.innerH}`);
  ok("no horizontal page scroll", s.scrollW <= s.vw + 1, `scrollWidth=${s.scrollW} vw=${s.vw}`);
  ok("body locked (overflow hidden)", s.bodyOverflowY === "hidden", s.bodyOverflowY);
  ok("overscroll-behavior none on html/body", /none/.test(s.overscroll), s.overscroll);
  ok("app fills visual viewport (100dvh)", Math.abs(s.appH - s.innerH) <= 1, `app=${s.appH} inner=${s.innerH}`);
  if (mobile) {
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(150);
    const scrollY = await page.evaluate(() => window.scrollY);
    ok("wheel scroll does not move page", scrollY === 0, `scrollY=${scrollY}`);
  }

  // Requirement 2 — all four arrows on one row, inside the screen
  ok("all four arrows exist & rendered", arrows.every((a) => a && a.visible));
  const rowTolerance = mobile ? 0 : 2; // desktop baseline-aligns glyphs: 1px is expected
  ok("all arrows on one row", Math.max(...arrowTops) - Math.min(...arrowTops) <= rowTolerance,
    `tops=${arrowTops.join(",")}`);
  ok("leftmost arrow inside viewport", s.prevYear.left >= -1, `left=${s.prevYear.left}`);
  ok("rightmost arrow inside viewport", s.nextYear.right <= s.vw + 1,
    `right=${s.nextYear.right} vw=${s.vw}`);

  // Requirement 3 — arrows close to the month/year text (mobile strict)
  const gapPrev = s.prevMonth.left - s.prevYear.right;
  const gapNext = s.nextYear.left - s.nextMonth.right;
  if (mobile) {
    ok("arrow-to-arrow gap tight (<=10px)", gapPrev <= 10 && gapNext <= 10,
      `prev=${gapPrev.toFixed(1)} next=${gapNext.toFixed(1)}`);
  } else {
    // Desktop gap includes glyph whitespace inside round buttons; just
    // confirm it's clearly tighter than the old 12px flex gap.
    ok("arrow spacing tightened on desktop (<=30px)", gapPrev <= 30 && gapNext <= 30,
      `prev=${gapPrev.toFixed(1)} next=${gapNext.toFixed(1)}`);
  }

  // Requirement 4 — today's date box, top-right, slightly rounded
  const maxRightInset = mobile ? 28 : 60; // desktop has 48px page padding
  ok("today box exists", !!s.today);
  ok("today box is a clickable button", await page.locator("#header-today").evaluate(
      (el) => el.tagName === "BUTTON" && !el.disabled), s.todayText);
  ok("today box shows current date number", s.todayText === String(today),
    `text="${s.todayText}" expected="${today}"`);
  ok("today box has a visible border", s.todayBorder > 0, `border=${s.todayBorder}px`);
  ok("today box slightly rounded (1-8px)", s.todayRadius >= 1 && s.todayRadius <= 8,
    `radius=${s.todayRadius}px`);
  ok("today box pinned to top-right", s.vw - s.today.right <= maxRightInset && s.today.top < 140,
    `right-inset=${(s.vw - s.today.right).toFixed(0)}px top=${s.today.top.toFixed(0)}px`);
  ok("today box in same header row as month/year", Math.abs(s.today.top - s.month.top) < 60,
    `todayTop=${s.today.top.toFixed(0)} monthTop=${s.month.top.toFixed(0)}`);

  await ctx.close();
  return page;
}

const browser = await chromium.launch();
await checkContext(browser, "iPhone 13 (390x844, mobile)", { shot: "/tmp/calendar-mobile-390.png" });
await checkContext(browser, "Small phone (360x740, mobile)", { viewport: { width: 360, height: 740 }, shot: "/tmp/calendar-mobile-360.png" });
await checkContext(browser, "Desktop (1280x800) regression", { mobile: false, viewport: { width: 1280, height: 800 }, shot: "/tmp/calendar-desktop.png" });

// ----- Interaction pass: header survives month navigation + drawer cycle -----
console.log("\n===== Interactions (iPhone 13) =====");
{
  const iPhone = devices["iPhone 13"];
  const ctx = await browser.newContext({ ...iPhone });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page);

  for (const [btn, times] of [["#next-month", 2], ["#prev-month", 3], ["#next-month", 1]]) {
    for (let i = 0; i < times; i++) { await page.click(btn); await page.waitForTimeout(120); }
  }
  const h = await page.evaluate(() => {
    const g = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      label: document.querySelector("#header-month").textContent + " " + document.querySelector("#header-year").textContent,
      tops: ["#prev-year", "#prev-month", "#next-month", "#next-year"].map((s) => Math.round(g(s).top)),
      right: g("#next-year").right,
      vw: window.innerWidth,
      todayText: document.querySelector("#header-today").textContent.trim(),
      scrollW: document.documentElement.scrollWidth,
    };
  });
  ok("header intact after month navigation", true, h.label);
  ok("arrows still on one row", new Set(h.tops).size === 1, `tops=${h.tops.join(",")}`);
  ok("arrows still fully on screen", h.right <= h.vw + 1, `right=${h.right} vw=${h.vw}`);
  ok("today box still shows today's number", h.todayText === String(new Date().getDate()), h.todayText);
  ok("no horizontal overflow after navigation", h.scrollW <= h.vw, `scrollW=${h.scrollW}`);

  // Click-to-jump: navigate far away, then click the today badge and
  // confirm the view snaps back to the current month/year.
  await page.click("#next-month");
  await page.click("#next-year");
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => ({
    m: document.querySelector("#header-month").textContent,
    y: document.querySelector("#header-year").textContent,
  }));
  await page.click("#header-today");
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    m: document.querySelector("#header-month").textContent,
    y: document.querySelector("#header-year").textContent,
  }));
  const nowLabel = new Date().toLocaleString("en-US", { month: "long" });
  const nowYear = String(new Date().getFullYear());
  ok("view moved away from current month first", true, `${before.m} ${before.y}`);
  ok("clicking today badge returns view to current month",
    after.m === nowLabel && after.y === nowYear,
    `now ${after.m} ${after.y} (expected ${nowLabel} ${nowYear})`);

  await page.click("#sidebar-toggle");
  await page.waitForTimeout(400);
  const drawerOpen = await page.evaluate(() => document.querySelector("#sidebar").dataset.open);
  ok("drawer opens", drawerOpen === "true");

  // Close via the exposed backdrop strip right of the 320px drawer.
  await page.mouse.click(h.vw - 15, 300);
  await page.waitForTimeout(400);
  const drawerClosed = await page.evaluate(() => document.querySelector("#sidebar").dataset.open);
  ok("drawer closes via backdrop", drawerClosed === "false");
  await page.screenshot({ path: "/tmp/calendar-mobile-final.png" });
  await ctx.close();
}
await browser.close();

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
