#!/usr/bin/env node
//
// Play Mode — settlement repair / backfill
// ========================================
//
// Settles the Play side of markets that are ALREADY terminal in Supabase but
// whose Play trades are still 'open' — the markets finalized before the
// post-finalization hook existed.
//
//     cd app
//     node scripts/play-settle-backfill.mjs --market <MARKET_ADDRESS>          # DRY RUN
//     node scripts/play-settle-backfill.mjs --market <MARKET_ADDRESS> --apply  # settles
//     node scripts/play-settle-backfill.mjs --all                              # DRY RUN, every stuck market
//
// WHAT IT DOES NOT DO
// -------------------
// It does not compute a payout, does not touch play_trades, play_accounts or
// play_ledger directly, and does not hardcode a balance. It calls the SAME
// play_settle_market RPC the app calls, which owns the pro-rata formula, the
// ledger writes and the idempotency guard. The winning outcome is read by the
// function from the markets row — it is never supplied here, so this script
// cannot settle Play on an outcome Real did not finalize on.
//
// SAFE TO RUN TWICE
// -----------------
// play_settle_market returns early on an already-terminal Play market state:
// no version bump, no ledger row, no balance change, no trade change. Re-runs
// are no-ops that report the ORIGINAL settlement.
//
// SAFETY
// ------
// DRY RUN by default: without --apply it only reads and prints. It also
// refuses to do anything unless the target market is genuinely terminal.
// Point it at Dev. It uses SUPABASE_SERVICE_ROLE_KEY from app/.env.local, so
// whatever that points at is what gets written when you pass --apply.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

/* ------------------------------- args ---------------------------------- */

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const MARKET = arg("market");
const ALL = flag("all");
const APPLY = flag("apply");

if (!MARKET && !ALL) {
  console.error(
    `\nUsage:\n` +
      `  node scripts/play-settle-backfill.mjs --market <MARKET_ADDRESS>\n` +
      `  node scripts/play-settle-backfill.mjs --market <MARKET_ADDRESS> --apply\n` +
      `  node scripts/play-settle-backfill.mjs --all [--apply]\n\n` +
      `Without --apply nothing is written: it reports what WOULD be settled.\n`
  );
  process.exit(2);
}

/* ------------------------------- env ----------------------------------- */

function loadEnv() {
  const file = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) {
    console.error(`\nMissing ${file}. Run this from the app/ directory.\n`);
    process.exit(2);
  }
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const env = loadEnv();
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("\nMissing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.\n");
  process.exit(2);
}

const supa = createClient(url, key, { auth: { persistSession: false } });

console.log(`\n${"=".repeat(70)}`);
console.log(`PLAY SETTLEMENT BACKFILL  ${APPLY ? "*** APPLY ***" : "(dry run)"}`);
console.log(`${"=".repeat(70)}`);
console.log(`  supabase  ${url.replace(/https:\/\/(\w{4})\w+/, "https://$1…")}`);
console.log(`  target    ${MARKET || "every terminal market with open Play trades"}`);
if (!APPLY) console.log(`  NOTE      dry run — nothing will be written. Add --apply to settle.`);

/* --------------------------- pick the markets --------------------------- */

async function candidates() {
  if (MARKET) return [MARKET];

  // Markets with at least one OPEN Play trade. Those are the only ones that
  // can possibly need repair.
  const { data: openTrades, error } = await supa
    .from("play_trades")
    .select("market_address")
    .eq("status", "open")
    .limit(5000);
  if (error) throw error;
  return [...new Set((openTrades || []).map((t) => t.market_address))];
}

const list = await candidates();
if (list.length === 0) {
  console.log(`\n  Nothing to do: no Play trades are open.\n`);
  process.exit(0);
}

/* ------------------------------- run ------------------------------------ */

let settled = 0;
let skipped = 0;
let failed = 0;

for (const market of list) {
  console.log(`\n${"-".repeat(70)}\n${market}\n${"-".repeat(70)}`);

  const { data: m, error: mErr } = await supa
    .from("markets")
    .select("market_address,question,resolution_status,resolved,cancelled,winning_outcome")
    .eq("market_address", market)
    .maybeSingle();

  if (mErr) {
    console.log(`  FAIL   market lookup: ${mErr.message}`);
    failed++;
    continue;
  }
  if (!m) {
    console.log(`  SKIP   market not found in public.markets`);
    skipped++;
    continue;
  }

  const status = String(m.resolution_status || "open").toLowerCase();
  const terminal =
    status === "cancelled" ||
    (status === "finalized" && m.winning_outcome !== null);

  console.log(`  title            ${m.question || "(untitled)"}`);
  console.log(`  resolution       ${status}`);
  console.log(`  winning_outcome  ${m.winning_outcome ?? "(none — cancelled)"}`);

  const { count: openCount } = await supa
    .from("play_trades")
    .select("id", { count: "exact", head: true })
    .eq("market_address", market)
    .eq("status", "open");
  console.log(`  open Play trades ${openCount ?? 0}`);

  if (!terminal) {
    console.log(`  SKIP   not terminal — Play must wait (a dispute can still move it)`);
    skipped++;
    continue;
  }

  if (!APPLY) {
    console.log(`  DRY    would call play_settle_market('${market}')`);
    continue;
  }

  const { data, error } = await supa.rpc("play_settle_market", {
    market_address_in: market,
  });

  if (error) {
    console.log(`  FAIL   ${error.message}`);
    failed++;
    continue;
  }

  const r = data || {};
  if (r.already_settled) {
    console.log(
      `  NOOP   already settled (outcome ${r.winning_outcome ?? "cancelled"}), ` +
        `original payout $${r.original_paid_out_usd ?? "0"} — nothing changed`
    );
  } else {
    console.log(
      `  OK     ${r.trades_settled ?? 0} trades settled, $${r.paid_out_usd ?? "0"} paid out ` +
        `(${r.reason ?? "?"})`
    );
  }
  settled++;
}

console.log(`\n${"=".repeat(70)}`);
console.log(
  APPLY
    ? `  ${settled} processed, ${skipped} skipped, ${failed} failed`
    : `  dry run complete — ${list.length} market(s) inspected, nothing written`
);
console.log(`${"=".repeat(70)}\n`);

process.exit(failed === 0 ? 0 : 1);
