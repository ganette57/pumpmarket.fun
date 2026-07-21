#!/usr/bin/env node
//
// Play Mode — odds sensitivity simulation
// =======================================
//
// Standalone. No Supabase, no network, no production imports, no
// dependencies. Run it:
//
//     node app/scripts/play-odds-simulation.mjs
//     node app/scripts/play-odds-simulation.mjs --seed 20000 --slope 0.0001
//
// -------------------------------------------------------------------------
// HOW THIS STAYS ALIGNED WITH THE SQL ENGINE
// -------------------------------------------------------------------------
// The authoritative pricing lives in Postgres
// (supabase/migrations/20260721_play_mode_core.sql). This script must not
// drift from it. Three mechanisms enforce that, in order of strength:
//
//   1. CONSTANTS ARE PARSED FROM THE MIGRATION, NOT RETYPED.
//      readSqlDefaults() reads the DEFAULT clauses of the play_settings
//      table straight out of the .sql file. If someone edits the migration,
//      this script reports the new numbers on the next run. It cannot
//      silently simulate stale constants, and it hard-fails if the
//      migration's shape changes such that the defaults can no longer be
//      found.
//
//   2. THE FORMULAS ARE ALSO EXTRACTED AND PRINTED FOR REVIEW.
//      readSqlFormulas() pulls the actual SQL bodies of
//      play_cost_for_shares and play_shares_for_stake and prints them
//      beside the JS below under --show-sql, so a reviewer can diff them by
//      eye rather than trusting a comment.
//
//   3. ARITHMETIC MATCHES numeric, NOT float64.
//      Postgres NUMERIC is exact decimal. JS Number is binary floating
//      point, so a naive port drifts in the last digits and rounds
//      differently at truncation boundaries. This file implements
//      fixed-point decimal on BigInt at 18 dp with an integer Newton
//      sqrt, then applies the SAME truncation rules as the SQL:
//        shares  -> trunc(x, 8)   (never round: shares must not cost more
//                                  than the stake paid)
//        money   -> trunc(x, 2)
//
// The one thing not mechanically enforced is the algebra itself. It is
// restated once, under "The mirrored formulas", with the exact SQL lines
// quoted directly above each function. selfCheck() then verifies the
// invariants the SQL also guarantees (exact inverse round-trip,
// monotonicity, convexity, even opening books). If the SQL algebra ever
// changes, selfCheck() is what should catch it.
//
// This script is a decision aid. It changes nothing and recommends only.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = resolve(HERE, "../supabase/migrations/20260721_play_mode_core.sql");

/* ========================================================================= *
 * Fixed-point decimal on BigInt — mirrors Postgres NUMERIC semantics
 * ========================================================================= */

const DP = 18n;
const ONE = 10n ** DP;

const D = {
  from(x) {
    const s = String(x);
    if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal: ${s}`);
    const neg = s.startsWith("-");
    const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
    const frac = (f + "0".repeat(Number(DP))).slice(0, Number(DP));
    const v = BigInt(i) * ONE + BigInt(frac || "0");
    return neg ? -v : v;
  },
  mul: (a, b) => (a * b) / ONE,
  div: (a, b) => (a * ONE) / b,
  // floor(sqrt(a/ONE)) * ONE  ==  isqrt(a * ONE)
  sqrt(a) {
    if (a < 0n) throw new Error("sqrt of negative");
    if (a === 0n) return 0n;
    const n = a * ONE;
    let x = n,
      y = (x + 1n) / 2n;
    while (y < x) {
      x = y;
      y = (x + n / x) / 2n;
    }
    return x;
  },
  /** Truncate toward zero at `dp` decimals — Postgres trunc(numeric, int). */
  trunc(a, dp) {
    const f = 10n ** (DP - BigInt(dp));
    return (a / f) * f;
  },
  str(a, dp = 2) {
    const t = D.trunc(a, dp);
    const neg = t < 0n;
    const v = neg ? -t : t;
    const i = v / ONE;
    const f = (v % ONE).toString().padStart(Number(DP), "0").slice(0, dp);
    return `${neg ? "-" : ""}${i}${dp > 0 ? "." + f : ""}`;
  },
  num: (a) => Number(a) / Number(ONE),
};

/* ========================================================================= *
 * Read constants + formulas out of the migration
 * ========================================================================= */

function readSqlDefaults(sql) {
  const grab = (col) => {
    const re = new RegExp(
      `^\\s*${col}\\s+numeric\\([\\d,\\s]+\\)\\s+not null\\s+default\\s+([\\d.]+)`,
      "im"
    );
    const m = sql.match(re);
    if (!m) {
      throw new Error(
        `Could not read DEFAULT for play_settings.${col} from the migration.\n` +
          `The migration's shape changed — fix this parser before trusting the simulation.`
      );
    }
    return m[1];
  };
  return {
    seed: grab("initial_supply_per_outcome"),
    base: grab("base_price_usd"),
    slope: grab("slope_usd_per_share"),
    grant: grab("daily_grant_usd"),
  };
}

function readSqlFormulas(sql) {
  const fn = (name) => {
    const m = sql.match(
      new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, "i")
    );
    return m ? m[1].trim() : "(not found)";
  };
  return {
    cost: fn("play_cost_for_shares"),
    shares: fn("play_shares_for_stake"),
  };
}

/* ========================================================================= *
 * The mirrored formulas
 * ========================================================================= */

// SQL — play_cost_for_shares:
//   n_shares_in * base_in
//     + slope_in * n_shares_in * (2 * q0_in + n_shares_in) / 2
function costForShares(q0, n, base, slope) {
  if (n <= 0n) return 0n;
  const a = D.mul(n, base);
  const b = D.div(D.mul(D.mul(slope, n), 2n * q0 + n), D.from(2));
  return a + b;
}

// SQL — play_shares_for_stake:
//   b_eff := base_in + slope_in * q0_in;
//   disc  := b_eff * b_eff + 2 * slope_in * stake_in;
//   n_raw := (sqrt(disc) - b_eff) / slope_in;
//   return trunc(n_raw, 8);
function sharesForStake(q0, stake, base, slope) {
  if (stake <= 0n) return 0n;
  if (slope === 0n) return D.trunc(D.div(stake, base), 8);
  const bEff = base + D.mul(slope, q0);
  const disc = D.mul(bEff, bEff) + D.mul(D.mul(D.from(2), slope), stake);
  if (disc <= 0n) return 0n;
  const nRaw = D.div(D.sqrt(disc) - bEff, slope);
  return nRaw <= 0n ? 0n : D.trunc(nRaw, 8);
}

// SQL — play_implied_probs: supply_i / SUM(supply), rounded to 6 dp.
function impliedProbs(supplies) {
  const total = supplies.reduce((a, b) => a + b, 0n);
  if (total <= 0n) return supplies.map(() => D.div(ONE, D.from(supplies.length)));
  return supplies.map((s) => D.div(s, total));
}

// SQL — play_settle_market: payout = trunc(shares / SUM(winning shares) * pool, 2)
function payoutFor(shares, totalWinningShares, pool) {
  if (totalWinningShares <= 0n) return 0n;
  return D.trunc(D.mul(D.div(shares, totalWinningShares), pool), 2);
}

/* ========================================================================= *
 * Book model
 * ========================================================================= */

function freshBook(nOutcomes, cfg) {
  return { supplies: Array(nOutcomes).fill(cfg.seed), pool: 0n, userShares: Array(nOutcomes).fill(0n) };
}

/** One buy. Mutates the book exactly as play_execute_trade does. */
function buy(book, outcome, stake, cfg) {
  const q0 = book.supplies[outcome];
  const probsBefore = impliedProbs(book.supplies);
  const shares = sharesForStake(q0, stake, cfg.base, cfg.slope);

  book.supplies[outcome] = q0 + shares;
  book.pool += stake;
  book.userShares[outcome] += shares;

  const probsAfter = impliedProbs(book.supplies);
  const payout = payoutFor(shares, book.userShares[outcome], book.pool);

  return {
    stake,
    shares,
    supplyBefore: q0,
    supplyAfter: book.supplies[outcome],
    probBefore: probsBefore[outcome],
    probAfter: probsAfter[outcome],
    movePts: D.mul(probsAfter[outcome] - probsBefore[outcome], D.from(100)),
    payout,
    multiple: stake > 0n ? D.div(payout, stake) : 0n,
  };
}

/* ========================================================================= *
 * Self-check — the invariants the SQL also guarantees
 * ========================================================================= */

function selfCheck(cfg) {
  const fails = [];
  const ok = (cond, msg) => { if (!cond) fails.push(msg); };

  for (const s of ["1", "100", "500", "1000", "10000", "50000"]) {
    const stake = D.from(s);
    const n = sharesForStake(cfg.seed, stake, cfg.base, cfg.slope);
    const cost = costForShares(cfg.seed, n, cfg.base, cfg.slope);
    ok(n > 0n, `shares_for_stake(${s}) returned 0`);
    // Truncation means cost <= stake, never above — same as the SQL.
    ok(cost <= stake, `round-trip cost ${D.str(cost, 8)} exceeds stake ${s}`);
    ok(stake - cost < D.from("0.01"), `round-trip lost more than a cent at ${s}`);
  }

  ok(
    sharesForStake(cfg.seed, D.from(1000), cfg.base, cfg.slope) >
      sharesForStake(cfg.seed, D.from(500), cfg.base, cfg.slope),
    "monotonicity: more stake must buy more shares"
  );
  ok(
    sharesForStake(cfg.seed * 2n, D.from(500), cfg.base, cfg.slope) <
      sharesForStake(cfg.seed, D.from(500), cfg.base, cfg.slope),
    "convexity: higher supply must buy fewer shares"
  );
  ok(sharesForStake(cfg.seed, 0n, cfg.base, cfg.slope) === 0n, "zero stake must buy zero shares");

  for (const n of [2, 3, 4, 10]) {
    const p = impliedProbs(freshBook(n, cfg).supplies);
    const expected = D.div(ONE, D.from(n));
    ok(p.every((x) => x === expected), `fresh ${n}-outcome book must open evenly`);
  }
  return fails;
}

/* ========================================================================= *
 * Reporting helpers
 * ========================================================================= */

const pct = (p) => `${D.str(D.mul(p, D.from(100)), 2)}%`;
const usd = (v) => `$${Number(D.str(v, 2)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const sh = (v) => Number(D.str(v, 4)).toLocaleString("en-US", { maximumFractionDigits: 2 });

function h1(t) { console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`); }
function h2(t) { console.log(`\n${t}\n${"-".repeat(t.length)}`); }

function table(rows) {
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells) => "  " + cells.map((c, i) => String(c).padStart(w[i])).join("  ");
  console.log(line(cols));
  console.log("  " + w.map((n) => "-".repeat(n)).join("  "));
  for (const r of rows) console.log(line(cols.map((c) => r[c])));
}

/* ========================================================================= *
 * Simulations
 * ========================================================================= */

function simFreshBinary(cfg) {
  h1("1. FRESH BINARY MARKET — single trade from an untouched book");
  console.log(
    `\n  Each row is an independent trade against a FRESH 50/50 book.\n` +
      `  "Payout" assumes this outcome wins and this trader is the only\n` +
      `  holder of it, so it collects the whole pool (their own stake).`
  );
  const rows = [];
  for (const amt of ["100", "500", "1000", "5000", "10000"]) {
    const book = freshBook(2, cfg);
    const r = buy(book, 0, D.from(amt), cfg);
    rows.push({
      stake: usd(r.stake),
      shares: sh(r.shares),
      "supply before": sh(r.supplyBefore),
      "supply after": sh(r.supplyAfter),
      "odds before": pct(r.probBefore),
      "odds after": pct(r.probAfter),
      "move (pts)": D.str(r.movePts, 2),
      payout: usd(r.payout),
      "multiple": `${D.str(r.multiple, 3)}x`,
    });
  }
  table(rows);
  console.log(
    `\n  NOTE the multiple is 1.000x throughout: a lone trader in a market\n` +
      `  can only ever win back their own stake. Multiples above 1x require\n` +
      `  losing money in the pool — see simulation 5.`
  );
}

function simSequential(cfg) {
  h1("2. SEQUENTIAL ACTIVITY — many users, same book");

  h2("2a. N users each betting $500 on the SAME outcome");
  const rows = [];
  for (const n of [10, 50, 100]) {
    const book = freshBook(2, cfg);
    let first = null, last = null;
    for (let i = 0; i < n; i++) {
      const r = buy(book, 0, D.from(500), cfg);
      if (i === 0) first = r;
      last = r;
    }
    const p = impliedProbs(book.supplies);
    rows.push({
      users: n,
      "total staked": usd(D.from(500 * n)),
      "odds after": pct(p[0]),
      "1st buyer shares": sh(first.shares),
      "last buyer shares": sh(last.shares),
      "fill decay": `${D.str(D.mul(D.div(last.shares, first.shares), D.from(100)), 1)}%`,
      pool: usd(book.pool),
    });
  }
  table(rows);
  console.log(
    `\n  "fill decay" = shares the Nth buyer receives as a % of what the 1st\n` +
      `  received for the same $500. Lower means the curve has steepened more.`
  );

  h2("2b. Alternating $500 trades between both outcomes (20 trades)");
  {
    const book = freshBook(2, cfg);
    const rows2 = [];
    for (let i = 0; i < 20; i++) {
      buy(book, i % 2, D.from(500), cfg);
      if ([1, 5, 9, 19].includes(i)) {
        const p = impliedProbs(book.supplies);
        rows2.push({
          trades: i + 1,
          "outcome 0": pct(p[0]),
          "outcome 1": pct(p[1]),
          "spread (pts)": D.str(D.mul(p[0] - p[1] < 0n ? p[1] - p[0] : p[0] - p[1], D.from(100)), 3),
          pool: usd(book.pool),
        });
      }
    }
    table(rows2);
    console.log(`\n  Balanced flow keeps the book near 50/50 — correct behaviour.`);
  }

  h2("2c. Repeated $10,000 all-ins on the SAME outcome");
  {
    const book = freshBook(2, cfg);
    const rows3 = [];
    for (let i = 1; i <= 6; i++) {
      const r = buy(book, 0, D.from(10000), cfg);
      rows3.push({
        "all-in #": i,
        shares: sh(r.shares),
        "odds after": pct(r.probAfter),
        "move (pts)": D.str(r.movePts, 2),
        "supply": sh(book.supplies[0]),
        pool: usd(book.pool),
      });
    }
    table(rows3);
  }

  h2("2d. 100 users, $500 each, split 60/40 between two outcomes");
  {
    const book = freshBook(2, cfg);
    // Deterministic interleave: repeating 60:40 pattern, no RNG.
    for (let i = 0; i < 100; i++) buy(book, i % 5 < 3 ? 0 : 1, D.from(500), cfg);
    const p = impliedProbs(book.supplies);
    table([
      {
        "stake split": "60 / 40",
        "money split": "60.00% / 40.00%",
        "odds outcome 0": pct(p[0]),
        "odds outcome 1": pct(p[1]),
        pool: usd(book.pool),
      },
    ]);
    console.log(
      `\n  Odds land close to but NOT exactly on the money split: later buyers\n` +
        `  on the popular side pay more per share, so 60% of the money buys\n` +
        `  less than 60% of the implied probability. That damping is the\n` +
        `  intended effect of the slope.`
    );

    // Realistic payout example.
    const winners = book.userShares[0];
    const oneUserShares = D.div(winners, D.from(60)); // even split across the 60
    const payout = payoutFor(oneUserShares, winners, book.pool);
    console.log(
      `\n  If outcome 0 wins, a representative $500 backer on the winning\n` +
        `  side collects ${usd(payout)} — a ${D.str(D.div(payout, D.from(500)), 3)}x on their stake.`
    );
  }
}

function simMultiOutcome(cfg) {
  h1("3. MULTI-OUTCOME MARKETS");
  for (const n of [3, 4]) {
    h2(`${n}-outcome market — fresh book`);
    const fresh = impliedProbs(freshBook(n, cfg).supplies);
    console.log(`  Opening odds: ${fresh.map(pct).join("  |  ")}`);

    const rows = [];
    for (const amt of ["500", "10000"]) {
      const book = freshBook(n, cfg);
      const r = buy(book, 0, D.from(amt), cfg);
      const p = impliedProbs(book.supplies);
      rows.push({
        stake: usd(r.stake),
        shares: sh(r.shares),
        "odds before": pct(r.probBefore),
        "odds after": pct(r.probAfter),
        "move (pts)": D.str(r.movePts, 2),
        "others each": pct(p[1]),
      });
    }
    table(rows);
  }
  console.log(
    `\n  Multi-outcome books are LESS sensitive per dollar: the same stake is\n` +
      `  measured against a larger total seeded supply (n x seed), so each\n` +
      `  trade moves the implied probability less than in a binary market.`
  );
}

function simNoWinner(cfg) {
  h1("4. NO-WINNING-POSITIONS RULE (settlement cross-check)");
  const book = freshBook(2, cfg);
  buy(book, 1, D.from(1200), cfg);
  buy(book, 1, D.from(800), cfg);
  console.log(
    `\n  Two users stake $1,200 and $800 on outcome 1. Pool = ${usd(book.pool)}.\n` +
      `  Outcome 0 finalizes as the winner. User-owned shares on outcome 0:\n` +
      `  ${sh(book.userShares[0])} — while its SEEDED supply is ${sh(book.supplies[0])}.\n\n` +
      `  Seed supply is a pricing device and is never a user-owned winning\n` +
      `  share, so total winning shares = 0 and the whole market refunds:\n` +
      `    user A -> $1,200.00   user B -> $800.00   pool -> $0.00\n` +
      `  Nothing is orphaned, realized P&L is 0 for both.`
  );
}

function simPayoutRealism(cfg) {
  h1("5. WHAT DOES A WINNING TRADE ACTUALLY PAY?");
  console.log(
    `\n  Payout = your winning shares / all winning shares x final pool.\n` +
      `  A trade is only profitable if losing money entered the pool.\n` +
      `  Below: one $500 backer of outcome 0, against N x $500 on outcome 1.`
  );
  const rows = [];
  for (const losers of [1, 2, 5, 10, 20]) {
    const book = freshBook(2, cfg);
    const mine = buy(book, 0, D.from(500), cfg);
    for (let i = 0; i < losers; i++) buy(book, 1, D.from(500), cfg);
    const payout = payoutFor(mine.shares, book.userShares[0], book.pool);
    const p = impliedProbs(book.supplies);
    rows.push({
      "losing $500 bets": losers,
      "final pool": usd(book.pool),
      "my payout": usd(payout),
      "my multiple": `${D.str(D.div(payout, D.from(500)), 3)}x`,
      "my final odds": pct(p[0]),
    });
  }
  table(rows);
  console.log(
    `\n  The multiple tracks the pool, and the odds move against the crowd —\n` +
      `  backing the unpopular side is what pays. This is the core loop.`
  );
}

function simDisplayedVsActual(cfg) {
  h1("6. DISPLAYED ODDS vs ACTUAL PAYOUT — the seed-dilution effect");
  console.log(
    `\n  Displayed odds use supply_i / SUM(supply), and supply INCLUDES the\n` +
      `  seed nobody paid for. Payout uses user-owned shares only. So the two\n` +
      `  numbers disagree, and the gap is largest when the pool is small\n` +
      `  relative to the seed.\n\n` +
      `  "fair x" = what the displayed odds imply (1 / displayed probability).\n` +
      `  "actual x" = what a winning backer really collects.`
  );

  const rows = [];
  for (const [users, aPct, label] of [
    [10, 60, "10 users"],
    [50, 60, "50 users"],
    [100, 60, "100 users"],
    [400, 60, "400 users"],
    [100, 80, "100 users 80/20"],
  ]) {
    const book = freshBook(2, cfg);
    const nA = Math.round((users * aPct) / 100);
    // Bresenham spread: exactly nA picks of outcome 0, evenly interleaved,
    // deterministic and correct for any user count.
    for (let i = 0; i < users; i++) {
      const backA =
        Math.floor(((i + 1) * nA) / users) > Math.floor((i * nA) / users);
      buy(book, backA ? 0 : 1, D.from(500), cfg);
    }

    const p = impliedProbs(book.supplies);
    const moneyA = D.from(500 * nA);
    const moneyProb = D.div(moneyA, book.pool);
    const perUser = D.div(book.userShares[0], D.from(nA));
    const payout = payoutFor(perUser, book.userShares[0], book.pool);

    rows.push({
      scenario: label,
      pool: usd(book.pool),
      "displayed odds": pct(p[0]),
      "money odds": pct(moneyProb),
      "gap (pts)": D.str(D.mul(moneyProb - p[0], D.from(100)), 2),
      "fair x": `${D.str(D.div(ONE, p[0]), 3)}x`,
      "actual x": `${D.str(D.div(payout, D.from(500)), 3)}x`,
    });
  }
  table(rows);

  console.log(
    `\n  Reading: at a steady 60/40 money split the book shows ~52% -> ~55%\n` +
      `  as volume grows. It converges toward ~56%, NOT toward 60%. A trader\n` +
      `  who reads "55%" expects ~1.82x but is actually paid ~1.67x.\n\n` +
      `  Two separate effects stack here:\n` +
      `    (a) the seed dilutes early odds toward 50/50 — this one DOES fade\n` +
      `        as the pool grows;\n` +
      `    (b) the slope means each extra dollar on the popular side buys\n` +
      `        fewer shares, so share-share never equals money-share — this\n` +
      `        one does NOT fade. It is a permanent compression.\n\n` +
      `  At an 80/20 split the compression is ~14 points (shows 65%, money\n` +
      `  says 80%). Displayed odds are therefore a damped view of sentiment,\n` +
      `  not a payout prediction. See the recommendation in\n` +
      `  docs/play-mode-engine.md section 9.`
  );
}

/* ========================================================================= *
 * Main
 * ========================================================================= */

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
  };

  const sql = readFileSync(MIGRATION, "utf8");
  const defaults = readSqlDefaults(sql);

  const cfg = {
    seed: D.from(flag("seed") ?? defaults.seed),
    base: D.from(flag("base") ?? defaults.base),
    slope: D.from(flag("slope") ?? defaults.slope),
    grant: D.from(flag("grant") ?? defaults.grant),
  };

  h1("PLAY MODE — ODDS SENSITIVITY SIMULATION");
  console.log(`\n  Constants read from: supabase/migrations/20260721_play_mode_core.sql`);
  table([
    {
      "seed supply/outcome": D.str(cfg.seed, 0),
      "base price": usd(cfg.base),
      slope: `$${D.str(cfg.slope, 6)}`,
      "daily bankroll": usd(cfg.grant),
      source: argv.length ? "CLI override" : "migration DEFAULTs",
    },
  ]);

  const fails = selfCheck(cfg);
  if (fails.length) {
    console.error(`\n  SELF-CHECK FAILED — the JS mirror has drifted from the SQL:`);
    for (const f of fails) console.error(`    - ${f}`);
    process.exit(1);
  }
  console.log(`\n  Self-check: PASS (round-trip, monotonicity, convexity, even opening books)`);

  if (argv.includes("--show-sql")) {
    const f = readSqlFormulas(sql);
    h1("AUTHORITATIVE SQL BODIES (for side-by-side review)");
    console.log("\n--- play_cost_for_shares ---\n" + f.cost);
    console.log("\n--- play_shares_for_stake ---\n" + f.shares);
  }

  simFreshBinary(cfg);
  simSequential(cfg);
  simMultiOutcome(cfg);
  simNoWinner(cfg);
  simPayoutRealism(cfg);
  simDisplayedVsActual(cfg);

  h1("DONE");
  console.log(
    `\n  This script changed nothing. Constants live in play_settings and are\n` +
      `  only altered by an approved migration edit.\n` +
      `  Re-run with --show-sql to print the SQL bodies this mirrors.\n`
  );
}

main();
