// Phase 2 E2E verification — does NOT touch real trading, just exercises
// the Fun Points RPCs end-to-end with two synthetic wallets, then cleans
// up after itself.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const c = createClient(url, key, { auth: { persistSession: false } });

// Make wallets unique per run so a re-run never collides with leftover rows
// from a previous run (and so a real Solana wallet can never overlap).
const RUN_ID = Date.now().toString(36).toUpperCase().slice(-6);
const REFERRER = `TEST_REFR_${RUN_ID}`;
const REFERRED = `TEST_REFD_${RUN_ID}`;
const OTHER    = `TEST_OTHR_${RUN_ID}`;

const log = (...a) => console.log("•", ...a);
const fail = (msg) => { console.error("✗ FAIL:", msg); process.exit(1); };
const eq = (a, b, label) => {
  if (a !== b) fail(`${label}: expected ${b}, got ${a}`);
  console.log("  ✓", label, "=", a);
};
const gt = (a, b, label) => {
  if (!(a > b)) fail(`${label}: expected > ${b}, got ${a}`);
  console.log("  ✓", label, "=", a, "(>", b, ")");
};

async function rpc(name, args) {
  const { data, error } = await c.rpc(name, args);
  if (error) fail(`${name} -> ${error.message}`);
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

async function account(w) {
  const { data } = await c.from("fun_points_accounts").select("*").eq("wallet", w).maybeSingle();
  return data;
}
async function ledger(w) {
  const { data } = await c.from("fun_points_ledger")
    .select("id,type,points,metadata,created_at")
    .eq("wallet", w)
    .order("created_at", { ascending: true });
  return data || [];
}
async function ref(w) {
  const { data } = await c.from("referrals").select("*").eq("referred_wallet", w).maybeSingle();
  return data;
}

async function cleanup() {
  for (const w of [REFERRER, REFERRED, OTHER]) {
    await c.from("daily_checkins").delete().eq("wallet", w);
    await c.from("task_completions").delete().eq("wallet", w);
    await c.from("fun_points_ledger").delete().eq("wallet", w);
    await c.from("referrals").delete().or(`referred_wallet.eq.${w},referrer_wallet.eq.${w}`);
    await c.from("fun_points_accounts").delete().eq("wallet", w);
  }
}

try {
  console.log("=== Phase 2 E2E verification ===");
  console.log("Run id:", RUN_ID);
  console.log("Referrer:", REFERRER);
  console.log("Referred:", REFERRED);
  console.log("");

  await cleanup();

  // -------------------------------------------------------------------
  // Step 1 — Create the referral relationship.
  // Expect: row in referrals + referrer ledger row 'referral_signup' +25
  // (Phase 2.1 rebalance: signup bonus is now 25, was 100)
  // -------------------------------------------------------------------
  log("Step 1: record referral");
  const created = await rpc("fp_record_referral", { referrer_in: REFERRER, referred_in: REFERRED });
  eq(created, true, "fp_record_referral returned");
  const refRow = await ref(REFERRED);
  eq(refRow?.referrer_wallet, REFERRER, "referrals.referrer_wallet");
  eq(refRow?.first_trade_at, null, "first_trade_at still null");
  const accAfterRef = await account(REFERRER);
  eq(accAfterRef?.total_points, 25, "referrer balance after signup");
  const refLedger1 = await ledger(REFERRER);
  eq(refLedger1.length, 1, "referrer ledger rows");
  eq(refLedger1[0].type, "referral_signup", "row 0 type");
  eq(refLedger1[0].points, 25, "row 0 points");
  console.log("");

  // -------------------------------------------------------------------
  // Step 1b — Re-record same referral. Must be idempotent.
  // -------------------------------------------------------------------
  log("Step 1b: re-record same referral (idempotent)");
  const re = await rpc("fp_record_referral", { referrer_in: REFERRER, referred_in: REFERRED });
  eq(re, false, "fp_record_referral returns false on dup");
  const accAfterDup = await account(REFERRER);
  eq(accAfterDup?.total_points, 25, "referrer balance unchanged");
  console.log("");

  // -------------------------------------------------------------------
  // Step 2 — First trade by referred user.
  // 10 SOL @ default rate (150) = 1500 USD = 1500 points.
  // Expect: trader +1500, referrer +100 first_trade + 150 trading bonus.
  // (Phase 2.1 rebalance: first_trade is now 100, was 250)
  // -------------------------------------------------------------------
  log("Step 2: first trade by referred user (10 SOL → 1500 USD → 1500 points)");
  const awarded1 = await rpc("fp_award_trade", { wallet_in: REFERRED, cost_sol_in: 10, metadata_in: { tx: "TEST_TX_1" } });
  eq(awarded1, 1500, "trader points awarded");

  const trader1 = await account(REFERRED);
  eq(trader1?.total_points, 1500, "trader balance after first trade");
  eq(trader1?.lifetime_points, 1500, "trader lifetime");

  const traderLedger1 = await ledger(REFERRED);
  eq(traderLedger1.length, 1, "trader ledger rows");
  eq(traderLedger1[0].type, "trade_volume", "trader row type");
  eq(traderLedger1[0].points, 1500, "trader row points");

  const refAcc1 = await account(REFERRER);
  // 25 (signup) + 100 (first trade) + 150 (10% of 1500) = 275
  eq(refAcc1?.total_points, 275, "referrer balance after first referred trade");
  eq(refAcc1?.lifetime_points, 275, "referrer lifetime");

  const refLedger2 = await ledger(REFERRER);
  eq(refLedger2.length, 3, "referrer ledger rows");
  const types = refLedger2.map(r => r.type);
  console.log("    referrer ledger types:", types.join(", "));
  const firstTrade = refLedger2.find(r => r.type === "referral_first_trade");
  const tradeBonus = refLedger2.find(r => r.type === "referral_trade_bonus");
  eq(firstTrade?.points, 100, "referral_first_trade points");
  eq(tradeBonus?.points, 150, "referral_trade_bonus points (10% of 1500)");

  const refRow2 = await ref(REFERRED);
  if (!refRow2?.first_trade_at) fail("first_trade_at should be set");
  console.log("  ✓ referrals.first_trade_at set:", refRow2.first_trade_at);
  console.log("");

  // -------------------------------------------------------------------
  // Step 3 — Second trade by same referred user. Verify:
  //   - trader gets points
  //   - referrer gets trading bonus AGAIN
  //   - referrer does NOT get a SECOND first_trade bonus
  // -------------------------------------------------------------------
  log("Step 3: second trade by referred user (4 SOL → 600 USD → 600 points)");
  const awarded2 = await rpc("fp_award_trade", { wallet_in: REFERRED, cost_sol_in: 4, metadata_in: { tx: "TEST_TX_2" } });
  eq(awarded2, 600, "trader points awarded");

  const trader2 = await account(REFERRED);
  eq(trader2?.total_points, 2100, "trader balance after second trade");

  const refAcc2 = await account(REFERRER);
  // previous 275 + 60 (10% of 600) = 335
  eq(refAcc2?.total_points, 335, "referrer balance after second referred trade");

  const refLedger3 = await ledger(REFERRER);
  const firstTradeCount = refLedger3.filter(r => r.type === "referral_first_trade").length;
  const tradeBonusCount = refLedger3.filter(r => r.type === "referral_trade_bonus").length;
  eq(firstTradeCount, 1, "referral_first_trade fires only ONCE");
  eq(tradeBonusCount, 2, "referral_trade_bonus fires per trade");
  console.log("");

  // -------------------------------------------------------------------
  // Step 4 — Trade by unrelated wallet. No referrer, no bonuses.
  // -------------------------------------------------------------------
  log("Step 4: unrelated wallet trades (no referrer → no bonus)");
  const awarded3 = await rpc("fp_award_trade", { wallet_in: OTHER, cost_sol_in: 1, metadata_in: {} });
  eq(awarded3, 150, "trader points awarded");
  const otherAcc = await account(OTHER);
  eq(otherAcc?.total_points, 150, "OTHER balance");
  // Make sure referrer balance did NOT move
  const refAcc3 = await account(REFERRER);
  eq(refAcc3?.total_points, 335, "referrer balance unchanged");
  console.log("");

  // -------------------------------------------------------------------
  // Step 5 — Daily check-in.
  // -------------------------------------------------------------------
  log("Step 5: daily check-in");
  const ck1 = await rpc("fp_claim_daily_checkin", { wallet_in: REFERRED });
  eq(ck1.awarded, true, "first checkin awarded");
  eq(ck1.points, 10, "checkin points");
  eq(ck1.streak, 1, "checkin streak");
  // Re-claim same day — must no-op
  const ck2 = await rpc("fp_claim_daily_checkin", { wallet_in: REFERRED });
  eq(ck2.awarded, false, "second checkin same day rejected");
  // Verify exactly one daily_checkins row
  const { data: dcRows } = await c.from("daily_checkins").select("*").eq("wallet", REFERRED);
  eq(dcRows?.length, 1, "daily_checkins rows for today");
  const traderAcc3 = await account(REFERRED);
  eq(traderAcc3?.current_streak, 1, "trader streak in account");
  if (!traderAcc3?.last_checkin_date) fail("last_checkin_date missing");
  console.log("  ✓ last_checkin_date set:", traderAcc3.last_checkin_date);
  console.log("");

  // -------------------------------------------------------------------
  // Step 6 — Leaderboard query helper
  // -------------------------------------------------------------------
  log("Step 6: leaderboard query");
  const { data: lb } = await c.from("fun_points_accounts")
    .select("wallet,lifetime_points,total_points")
    .order("lifetime_points", { ascending: false })
    .in("wallet", [REFERRER, REFERRED, OTHER]);
  console.log("    Top within test cohort:");
  for (const r of lb || []) {
    console.log(`      ${r.wallet}  lifetime=${r.lifetime_points}  total=${r.total_points}`);
  }
  console.log("");

  // -------------------------------------------------------------------
  // Full dump
  // -------------------------------------------------------------------
  console.log("=== Final account state ===");
  for (const w of [REFERRER, REFERRED, OTHER]) {
    const a = await account(w);
    console.log(`  ${w}: total=${a?.total_points} lifetime=${a?.lifetime_points} streak=${a?.current_streak} code=${a?.referral_code}`);
  }
  console.log("=== Full referrer ledger ===");
  const allRef = await ledger(REFERRER);
  for (const r of allRef) {
    console.log(`  +${r.points}  ${r.type}  meta=${JSON.stringify(r.metadata)}`);
  }
  console.log("=== Full referred ledger ===");
  const allTrader = await ledger(REFERRED);
  for (const r of allTrader) {
    console.log(`  +${r.points}  ${r.type}  meta=${JSON.stringify(r.metadata)}`);
  }
  console.log("");

  console.log("=== ALL PHASE 2 ASSERTIONS PASSED ===");

  // Test data is left in place so the screenshot step can read it.
  console.log("Test wallets preserved for screenshots:");
  console.log("  Referrer:", REFERRER);
  console.log("  Referred:", REFERRED);
  console.log("Re-run scripts/cleanup-phase2.mjs to delete them.");

  // Print so the orchestrator can inject these wallets into the preview
  console.log("---WALLETS---");
  console.log(JSON.stringify({ REFERRER, REFERRED, OTHER }));
} catch (e) {
  console.error("Uncaught:", e?.message || e);
  process.exit(1);
}
