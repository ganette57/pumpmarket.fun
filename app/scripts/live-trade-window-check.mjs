#!/usr/bin/env node
//
// Live flash markets — trade-window checks
// ========================================
//
// Standalone. No Supabase, no network, no dev server. Run it:
//
//     node app/scripts/live-trade-window-check.mjs
//
// -------------------------------------------------------------------------
// HOW THIS STAYS ALIGNED WITH THE PRODUCT SPEC
// -------------------------------------------------------------------------
// Two mechanisms, in order of strength:
//
//   1. THE MODULE UNDER TEST IS THE REAL ONE. src/lib/liveFlashWindows.ts is
//      transpiled in-process with the TypeScript compiler that already ships
//      as a devDependency, then imported. Nothing is reimplemented here, so
//      the checks cannot pass against a stale copy of the logic.
//
//   2. THE MAPPING IS ASSERTED AGAINST THE SPEC, NOT AGAINST ITSELF. The
//      duration -> trade-window table below is the product requirement typed
//      out once. If someone edits the mapping in the lib, this fails.
//
// Exit code 0 = all checks passed, 1 = at least one failed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.join(here, "..", "src", "lib", "liveFlashWindows.ts");

const transpiled = ts.transpileModule(readFileSync(modulePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;

const lib = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

const {
  FLASH_DURATION_OPTIONS,
  DEFAULT_FLASH_DURATION_MIN,
  normalizeFlashDurationMin,
  isSupportedFlashDurationMin,
  assertSupportedFlashDurationMin,
  tradeWindowSecondsFor,
  computeFlashMarketWindow,
  deriveTradeWindowState,
  inferStartedAtMs,
  parseTimestampMs,
  secondsUntil,
  formatMmSs,
  tradeWindowUrgency,
} = lib;

/* -------------------------------------------------------------------------- */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push(`${name}\n    ${String(e?.message || e)}`);
  }
}

function eq(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

function ok(cond, what) {
  if (!cond) throw new Error(what);
}

/* -------------------------------------------------------------------------- */
/*  A. The mapping                                                             */
/* -------------------------------------------------------------------------- */

// The product requirement, typed out once. Minutes -> seconds of trading.
const SPEC = { 1: 20, 3: 60, 5: 90, 10: 180, 15: 300, 30: 600 };

check("duration options are exactly 1/3/5/10/15/30", () => {
  eq([...FLASH_DURATION_OPTIONS], [1, 3, 5, 10, 15, 30], "options");
});

check("default duration is one of the options", () => {
  ok(
    FLASH_DURATION_OPTIONS.includes(DEFAULT_FLASH_DURATION_MIN),
    `default ${DEFAULT_FLASH_DURATION_MIN} is not in the option list`,
  );
});

for (const [minutes, seconds] of Object.entries(SPEC)) {
  check(`${minutes} min market trades for ${seconds}s`, () => {
    eq(tradeWindowSecondsFor(Number(minutes)), seconds, "window");
  });
}

check("every window is strictly shorter than its market", () => {
  for (const d of FLASH_DURATION_OPTIONS) {
    ok(
      tradeWindowSecondsFor(d) < d * 60,
      `${d} min: window ${tradeWindowSecondsFor(d)}s is not shorter than ${d * 60}s`,
    );
  }
});

// The full gameplay loop per duration: trade for W, then watch for the rest.
// Stated as an independent table so a change to either half is caught.
const LOOP = {
  1: { trade: 20, watch: 40 },
  3: { trade: 60, watch: 120 },
  5: { trade: 90, watch: 210 },
  10: { trade: 180, watch: 420 },
  15: { trade: 300, watch: 600 },
  30: { trade: 600, watch: 1200 },
};

for (const [minutes, { trade, watch }] of Object.entries(LOOP)) {
  check(`${minutes} min: ${trade}s trading then ${watch}s locked-watch`, () => {
    const t0 = Date.parse("2026-08-09T20:00:00.000Z");
    const w = computeFlashMarketWindow(Number(minutes), t0);
    eq((w.lockAt - t0) / 1000, trade, "trading phase");
    eq((w.endAt - w.lockAt) / 1000, watch, "locked-watch phase");
    eq((w.endAt - t0) / 1000, Number(minutes) * 60, "total market length");
  });
}

/* -------------------------------------------------------------------------- */
/*  B. Normalization of untrusted durations                                    */
/* -------------------------------------------------------------------------- */

check("creation REJECTS unsupported durations", () => {
  for (const bad of [2, 7, 20, 45, 0, -1, 1.5, "5", null, undefined, NaN]) {
    ok(
      !isSupportedFlashDurationMin(bad),
      `${String(bad)} must not be reported as supported`,
    );
    let threw = false;
    try {
      assertSupportedFlashDurationMin(bad);
    } catch {
      threw = true;
    }
    ok(threw, `assertSupportedFlashDurationMin(${String(bad)}) must throw`);
  }
});

check("creation accepts every offered duration", () => {
  for (const d of FLASH_DURATION_OPTIONS) {
    ok(isSupportedFlashDurationMin(d), `${d} must be supported`);
    eq(assertSupportedFlashDurationMin(d), d, `${d} passes through`);
    // computeFlashMarketWindow shares the same gate.
    ok(computeFlashMarketWindow(d).lockAt instanceof Date, `${d} builds a window`);
  }
});

check("computeFlashMarketWindow throws rather than snapping", () => {
  let threw = false;
  try {
    computeFlashMarketWindow(7);
  } catch {
    threw = true;
  }
  ok(threw, "a 7 min market must not be silently created as 5 min");
});

check("odd durations snap onto the option list (READ paths only)", () => {
  eq(normalizeFlashDurationMin(7), 5, "7 -> nearest");
  eq(normalizeFlashDurationMin(12), 10, "12 -> nearest");
  eq(normalizeFlashDurationMin(100), 30, "100 -> clamped to max");
  eq(normalizeFlashDurationMin(1), 1, "1 -> itself");
});

check("garbage durations fall back to the default", () => {
  for (const bad of [0, -5, NaN, null, undefined, "abc", {}]) {
    eq(
      normalizeFlashDurationMin(bad),
      DEFAULT_FLASH_DURATION_MIN,
      `${String(bad)} -> default`,
    );
  }
});

check("a legacy duration still yields a usable window", () => {
  const w = tradeWindowSecondsFor(7);
  ok(w > 0 && w < 7 * 60, `7 min legacy window out of range: ${w}`);
});

/* -------------------------------------------------------------------------- */
/*  C. Timestamps — the core product rule                                      */
/* -------------------------------------------------------------------------- */

check("3 min market at 20:00:00 locks 20:01:00 and ends 20:03:00", () => {
  const t0 = Date.parse("2026-08-09T20:00:00.000Z");
  const w = computeFlashMarketWindow(3, t0);
  eq(w.startedAt.toISOString(), "2026-08-09T20:00:00.000Z", "started_at");
  eq(w.lockAt.toISOString(), "2026-08-09T20:01:00.000Z", "lock_at");
  eq(w.endAt.toISOString(), "2026-08-09T20:03:00.000Z", "end_at");
});

check("the trade window never extends end_at", () => {
  const t0 = Date.parse("2026-08-09T12:00:00.000Z");
  for (const d of FLASH_DURATION_OPTIONS) {
    const w = computeFlashMarketWindow(d, t0);
    eq(
      w.endAt.getTime() - t0,
      d * 60 * 1000,
      `${d} min: end_at is not exactly T0 + duration`,
    );
    ok(w.lockAt < w.endAt, `${d} min: lock_at is not before end_at`);
  }
});

check("chained markets each get a fresh clock", () => {
  const first = computeFlashMarketWindow(1, Date.parse("2026-08-09T20:00:00Z"));
  // The next market starts when the host swaps it in, not when the last ended,
  // and its window comes from ITS OWN duration — nothing is inherited.
  const second = computeFlashMarketWindow(5, Date.parse("2026-08-09T20:04:30Z"));
  eq(second.startedAt.toISOString(), "2026-08-09T20:04:30.000Z", "fresh T0");
  eq(second.lockAt.toISOString(), "2026-08-09T20:06:00.000Z", "fresh lock_at");
  eq(second.endAt.toISOString(), "2026-08-09T20:09:30.000Z", "fresh end_at");
  eq(first.tradeWindowSec, 20, "first market keeps its own 20s window");
  eq(second.tradeWindowSec, 90, "second market gets its own 90s window");
});

/* -------------------------------------------------------------------------- */
/*  D. Deadline logic — the part that must survive a sleeping device           */
/* -------------------------------------------------------------------------- */

const T0 = Date.parse("2026-08-09T20:00:00.000Z");
const W3 = computeFlashMarketWindow(3, T0); // lock +60s, end +180s

function stateAt(offsetSec) {
  return deriveTradeWindowState({
    lockAtMs: W3.lockAt.getTime(),
    endAtMs: W3.endAt.getTime(),
    startedAtMs: T0,
    nowMs: T0 + offsetSec * 1000,
  });
}

check("trading is open for the first 60 seconds", () => {
  ok(stateAt(0).open, "T+0 should be open");
  ok(stateAt(59).open, "T+59 should be open");
  eq(stateAt(0).secondsToLock, 60, "T+0 seconds to lock");
  eq(stateAt(30).secondsToLock, 30, "T+30 seconds to lock");
});

check("trading locks exactly at lock_at, not a second early or late", () => {
  ok(stateAt(59.999).open, "T+59.999 should still be open");
  ok(!stateAt(60).open, "T+60 must be locked");
  ok(!stateAt(61).open, "T+61 must be locked");
});

check("the market keeps running after the lock", () => {
  const s = stateAt(60);
  eq(s.secondsToEnd, 120, "2:00 of market left at lock");
  eq(formatMmSs(s.secondsToEnd), "2:00", "displayed as 2:00 LEFT");
  eq(stateAt(179).secondsToEnd, 1, "one second before the end");
  eq(stateAt(180).secondsToEnd, 0, "market over");
});

check("a viewer joining midway sees the true remaining fraction", () => {
  // Joining at T+45s of a 60s window: a mount-relative timer would show a
  // full bar. From timestamps it must show a quarter left, in the red band.
  const s = stateAt(45);
  eq(Math.round(s.fractionRemaining * 100), 25, "fraction remaining");
  eq(s.secondsToLock, 15, "seconds to lock");
  ok(s.open, "still open at T+45");
});

check("a viewer joining after the lock sees TRADING LOCKED immediately", () => {
  const s = stateAt(90);
  ok(!s.open, "must be locked");
  eq(s.fractionRemaining, 0, "bar must be empty");
  eq(s.secondsToLock, 0, "no lock time left");
  eq(s.secondsToEnd, 90, "1:30 of market still to watch");
});

check("a long sleep lands on the right frame, not an accumulated one", () => {
  // Same call, huge jump in `now` — there is no counter to fall behind.
  const s = stateAt(3600);
  ok(!s.open, "locked");
  eq(s.secondsToEnd, 0, "market long over");
});

check("T0 is recoverable from lock_at + end_at alone", () => {
  // The bar must stay exact even when markets.created_at is absent from the
  // payload (getMarketByAddress degrades to narrower selects on old schemas).
  const t0 = Date.parse("2026-08-09T20:00:00.000Z");
  for (const d of FLASH_DURATION_OPTIONS) {
    const w = computeFlashMarketWindow(d, t0);
    eq(
      inferStartedAtMs(w.lockAt.getTime(), w.endAt.getTime()),
      t0,
      `${d} min: inferred T0`,
    );
  }
});

check("without created_at the drain fraction is still correct", () => {
  const s = deriveTradeWindowState({
    lockAtMs: W3.lockAt.getTime(),
    endAtMs: W3.endAt.getTime(),
    startedAtMs: null, // simulate the narrower select
    nowMs: T0 + 45 * 1000,
  });
  eq(Math.round(s.fractionRemaining * 100), 25, "fraction from inferred T0");
});

check("an unrecognisable window infers nothing rather than guessing", () => {
  eq(inferStartedAtMs(1000, 1000 + 999_000), null, "nonsense gap -> null");
  eq(inferStartedAtMs(null, 5000), null, "null lock -> null");
});

check("markets with no lock timestamp yield no bar", () => {
  const s = deriveTradeWindowState({
    lockAtMs: null,
    endAtMs: W3.endAt.getTime(),
    startedAtMs: T0,
    nowMs: T0,
  });
  eq(s, null, "legacy market must produce null, not a locked state");
});

/* -------------------------------------------------------------------------- */
/*  E. Urgency bands                                                           */
/* -------------------------------------------------------------------------- */

check("urgency bands match the spec boundaries", () => {
  eq(tradeWindowUrgency(1.0), "green", "100%");
  eq(tradeWindowUrgency(0.51), "green", "51%");
  eq(tradeWindowUrgency(0.5), "yellow", "50% is the top of yellow");
  eq(tradeWindowUrgency(0.26), "yellow", "26%");
  eq(tradeWindowUrgency(0.25), "orange", "25% is the top of orange");
  eq(tradeWindowUrgency(0.11), "orange", "11%");
  eq(tradeWindowUrgency(0.1), "red", "10% is the top of red");
  eq(tradeWindowUrgency(0), "red", "0%");
});

/* -------------------------------------------------------------------------- */
/*  F. Timestamp parsing / formatting                                          */
/* -------------------------------------------------------------------------- */

check("bare Supabase timestamps are read as UTC, not local", () => {
  const bare = parseTimestampMs("2026-08-09 20:00:00");
  const explicit = parseTimestampMs("2026-08-09T20:00:00Z");
  eq(bare, explicit, "a missing timezone must not shift the window by hours");
});

check("unparseable timestamps yield null, never 0", () => {
  for (const bad of [null, undefined, "", "not a date"]) {
    eq(parseTimestampMs(bad), null, `${String(bad)} -> null`);
  }
});

check("secondsUntil never goes negative", () => {
  eq(secondsUntil(1000, 5000), 0, "past deadline");
  eq(secondsUntil(null, 5000), 0, "null deadline");
});

check("MM:SS formatting", () => {
  eq(formatMmSs(0), "0:00", "zero");
  eq(formatMmSs(20), "0:20", "1 min market window");
  eq(formatMmSs(90), "1:30", "5 min market window");
  eq(formatMmSs(600), "10:00", "30 min market window");
  eq(formatMmSs(3661), "1:01:01", "over an hour");
});

/* -------------------------------------------------------------------------- */

console.log(`\n${passed} check${passed === 1 ? "" : "s"} passed`);
if (failures.length > 0) {
  console.error(`${failures.length} FAILED:\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log("✓ live flash trade-window logic matches the spec\n");
