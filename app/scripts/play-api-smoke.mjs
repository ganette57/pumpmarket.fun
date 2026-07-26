#!/usr/bin/env node
//
// Play Mode — API smoke test (development only)
// =============================================
//
// Drives the full Play session handshake and trading flow against a LOCAL
// dev server, using a throwaway ed25519 keypair as the wallet. Solana
// wallets are ed25519, so a nacl keypair signs exactly like Phantom does.
//
//     cd app
//     npm run dev                      # in one terminal
//     node scripts/play-api-smoke.mjs --market <MARKET_ADDRESS>
//
// <MARKET_ADDRESS> must be a row in public.markets on your DEV database
// with resolution_status='open', resolved=false, is_blocked not true and
// end_date in the future.
//
// SAFETY
// ------
// Refuses to run against anything but localhost/127.0.0.1. This script
// creates a Play account and spends virtual money; it must never be
// pointed at a deployed environment. It touches no Real table and signs
// no Solana transaction.
//
// Requires the dev server to have PLAY_SESSION_SECRET set (>= 32 chars).

import nacl from "tweetnacl";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";

/* ----------------------------- args + guard ----------------------------- */

const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const BASE = arg("base", "http://localhost:3000").replace(/\/$/, "");
const MARKET = arg("market");
const OUTCOME = Number(arg("outcome", "0"));
const STAKE = arg("stake", "500");

{
  const host = new URL(BASE).hostname;
  if (!["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host)) {
    console.error(
      `\nREFUSING TO RUN.\n` +
        `  --base resolved to host "${host}".\n` +
        `  This script spends virtual money and creates accounts; it is\n` +
        `  localhost-only by design. Do not point it at a deployed env.\n`
    );
    process.exit(2);
  }
}

if (!MARKET) {
  console.error(
    `\nMissing --market.\n\n` +
      `  node scripts/play-api-smoke.mjs --market <MARKET_ADDRESS>\n\n` +
      `  Find one on your DEV database with:\n` +
      `    select market_address, question from public.markets\n` +
      `     where resolution_status = 'open' and coalesce(resolved,false) = false\n` +
      `       and coalesce(is_blocked,false) = false and end_date > now()\n` +
      `     limit 5;\n`
  );
  process.exit(2);
}

/* ------------------------------- helpers -------------------------------- */

let PASS = 0;
let FAIL = 0;

function check(label, cond, detail = "") {
  if (cond) {
    PASS++;
    console.log(`  PASS  ${label}`);
  } else {
    FAIL++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

function step(n, t) {
  console.log(`\n${"-".repeat(70)}\n${n}. ${t}\n${"-".repeat(70)}`);
}

/* --------------------------- money comparison --------------------------- */
//
// Supabase returns NUMERIC INCONSISTENTLY across our own code paths:
//
//   * lib/playEngine.ensureDailyGrant() does `String(data)`, and a bare
//     NUMERIC RPC scalar arrives as a JS number, so 10000.00 -> "10000"
//     (the ".00" is gone);
//   * play_execute_trade returns balance via jsonb_build_object(), and
//     to_jsonb(9500.00::numeric) -> JSON number -> JS number 9500.
//
// So the same balance can be the string "10000" in one response and the
// number 9500 in another. Strict `===` between "9500" and 9500, or
// between "10000" and "10000.00", is a false negative — which is exactly
// the four failures observed. And Number() equality would drag
// authoritative money through binary float.
//
// toCents() normalizes either form to an exact integer number of cents
// (BigInt, no float), truncating to 2 dp the same way the SQL engine
// does. All money comparisons below go through it.

function toCents(x) {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null; // reject anything non-decimal
  const neg = s.startsWith("-");
  const [i, f = ""] = (neg ? s.slice(1) : s).split(".");
  const frac = (f + "00").slice(0, 2); // pad/truncate to cents
  const cents = BigInt(i) * 100n + BigInt(frac);
  return neg ? -cents : cents;
}

/** Exact money equality, tolerant of number-vs-string and trailing zeros. */
function moneyEq(a, b) {
  const x = toCents(a);
  const y = toCents(b);
  return x !== null && y !== null && x === y;
}

/** a - b in cents (BigInt), or null if either is unparseable. */
function moneyDiffCents(a, b) {
  const x = toCents(a);
  const y = toCents(b);
  return x === null || y === null ? null : x - y;
}

const GRANT_USD = "10000"; // approved daily_grant_usd

let COOKIE = null;

async function post(path, body, { withCookie = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (withCookie && COOKIE) headers.cookie = COOKIE;

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });

  const setCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);

  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json, setCookie };
}

/* -------------------------------- wallet -------------------------------- */

const kp = nacl.sign.keyPair();
const WALLET = bs58.encode(Buffer.from(kp.publicKey));
const sign = (msg) =>
  bs58.encode(
    Buffer.from(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey))
  );

/* --------------------------------- run ---------------------------------- */

console.log(`\n${"=".repeat(70)}`);
console.log(`PLAY API SMOKE TEST`);
console.log(`${"=".repeat(70)}`);
console.log(`  base    ${BASE}`);
console.log(`  wallet  ${WALLET}  (throwaway, generated per run)`);
console.log(`  market  ${MARKET}`);
console.log(`  trade   outcome ${OUTCOME}, $${STAKE}`);

/* 1 — unauthenticated access must be refused */
step(1, "Session required (no cookie yet)");
{
  const r = await post("/api/play/state", {}, { withCookie: false });
  check("POST /api/play/state without a session -> 401", r.status === 401,
        `got ${r.status} ${JSON.stringify(r.json)}`);
}

/* 2 — nonce */
step(2, "POST /api/play/auth/nonce");
let nonce, message;
{
  const r = await post("/api/play/auth/nonce", { wallet: WALLET }, { withCookie: false });
  check("returns 200", r.status === 200, JSON.stringify(r.json));
  nonce = r.json?.nonce;
  message = r.json?.message;
  check("returns a nonce", !!nonce);
  check("returns the message to sign", !!message && message.includes(WALLET));
  check("returns an expiry", !!r.json?.expires_at);
  if (message) console.log(`\n        --- message ---\n${message.split("\n").map((l) => "        " + l).join("\n")}`);
}
if (!nonce) { console.error("\nCannot continue without a nonce."); process.exit(1); }

/* 3 — bad signature must be rejected AND burn the nonce */
step(3, "Wrong signature is rejected, and burns the challenge");
{
  const bad = sign("not the real message");
  const r = await post("/api/play/auth/verify",
    { wallet: WALLET, nonce, signature: bad }, { withCookie: false });
  check("bad signature -> 403", r.status === 403, `got ${r.status} ${JSON.stringify(r.json)}`);

  const good = sign(message);
  const r2 = await post("/api/play/auth/verify",
    { wallet: WALLET, nonce, signature: good }, { withCookie: false });
  check("the burnt nonce cannot be reused even with a GOOD signature -> 401",
        r2.status === 401, `got ${r2.status} ${JSON.stringify(r2.json)}`);
}

/* 4 — real sign-in */
step(4, "POST /api/play/auth/verify (fresh nonce, correct signature)");
{
  const n = await post("/api/play/auth/nonce", { wallet: WALLET }, { withCookie: false });
  const sig = sign(n.json.message);
  const r = await post("/api/play/auth/verify",
    { wallet: WALLET, nonce: n.json.nonce, signature: sig }, { withCookie: false });

  check("returns 200", r.status === 200, JSON.stringify(r.json));
  check("account created for our wallet", r.json?.account?.wallet_address === WALLET);
  check("daily grant applied ($10,000)", moneyEq(r.json?.account?.balance_usd, GRANT_USD),
        `balance_usd = ${r.json?.account?.balance_usd}`);
  check("an active season is returned", !!r.json?.season?.id);

  const raw = (r.setCookie || []).find((c) => c.startsWith("play_session="));
  check("Set-Cookie play_session present", !!raw);
  check("cookie is HttpOnly", !!raw && /HttpOnly/i.test(raw), raw || "");
  check("cookie is SameSite=Lax", !!raw && /SameSite=Lax/i.test(raw), raw || "");
  if (raw) COOKIE = raw.split(";")[0];

  /* nonce replay across a second sign-in */
  const r2 = await post("/api/play/auth/verify",
    { wallet: WALLET, nonce: n.json.nonce, signature: sig }, { withCookie: false });
  check("replaying the consumed nonce -> 401", r2.status === 401, `got ${r2.status}`);
}
if (!COOKIE) { console.error("\nCannot continue without a session cookie."); process.exit(1); }

/* 5 — state */
step(5, "POST /api/play/state");
let balanceBefore;
{
  const r = await post("/api/play/state", { market_address: MARKET });
  check("returns 200", r.status === 200, JSON.stringify(r.json));
  balanceBefore = r.json?.account?.balance_usd;
  check("balance is present", balanceBefore !== undefined && balanceBefore !== null);
  // Fresh throwaway wallet -> exactly one grant today, no second grant.
  check("balance is the single daily grant, no double-grant",
        moneyEq(balanceBefore, GRANT_USD), `balance_usd = ${balanceBefore}`);
  check("open_trades is an array", Array.isArray(r.json?.open_trades));

  // NOTE: /state does NOT create the Play market state. The state is
  // ensured on the first /quote or /trade (play_ensure_market_state runs
  // inside those, not inside /state). It is also GLOBAL per market, so on
  // a re-run against the same --market it may already exist here. Either
  // way we make no market_state assertion at this point — it is verified
  // right after /quote, below.
  if (r.json?.market_state) {
    const ms = r.json.market_state;
    console.log(`        (market already had Play state from a prior run) ` +
                `v=${ms.version} pool=$${ms.virtual_pool_usd}`);
  } else {
    console.log(`        (no Play market state yet — expected before any quote/trade)`);
  }
}

/* 6 — quote */
step(6, "POST /api/play/quote");
let quotedShares;
{
  const r = await post("/api/play/quote", {
    market_address: MARKET, outcome_index: OUTCOME, stake_usd: STAKE,
  });
  check("returns 200", r.status === 200, JSON.stringify(r.json));
  const q = r.json?.quote;
  quotedShares = q?.shares;
  check("returns shares", !!quotedShares);
  check("returns implied probs before and after",
        Array.isArray(q?.implied_probs) && Array.isArray(q?.implied_probs_after));
  check("returns an estimated payout", q?.estimated_payout_usd !== undefined);
  if (q) {
    console.log(`        stake=$${q.stake_usd} shares=${q.shares} ` +
                `avg=$${q.avg_price_usd}\n` +
                `        odds ${q.implied_probs} -> ${q.implied_probs_after}\n` +
                `        est payout=$${q.estimated_payout_usd} (${q.estimated_multiple}x)`);
  }

  // Quote ensures the Play market state exists but must move NO money and
  // create NO trade. Verify both via a follow-up /state.
  const s = await post("/api/play/state", { market_address: MARKET });
  check("market state exists after /quote (ensured, not on /state)",
        !!s.json?.market_state?.id, JSON.stringify(s.json?.market_state));
  check("quote moved no money (balance unchanged)",
        moneyEq(s.json?.account?.balance_usd, balanceBefore),
        `${balanceBefore} -> ${s.json?.account?.balance_usd}`);
  check("quote created no trade (open_trades still empty)",
        Array.isArray(s.json?.open_trades) && s.json.open_trades.length === 0,
        `open_trades = ${JSON.stringify(s.json?.open_trades)}`);
  if (s.json?.market_state) {
    const ms = s.json.market_state;
    console.log(`        market_state: outcomes=${ms.outcome_count} ` +
                `pool=$${ms.virtual_pool_usd} supplies=[${ms.outcome_supplies}] v=${ms.version}`);
  }
}

/* 7 — trade + idempotency */
step(7, "POST /api/play/trade (and double-submit)");
const CLIENT_TRADE_ID = randomUUID();
let tradeId, balanceAfter;
{
  const body = {
    market_address: MARKET, outcome_index: OUTCOME,
    stake_usd: STAKE, client_trade_id: CLIENT_TRADE_ID,
  };

  const r = await post("/api/play/trade", body);
  check("first submit -> 201", r.status === 201, `got ${r.status} ${JSON.stringify(r.json)}`);
  check("replayed = false", r.json?.replayed === false);
  tradeId = r.json?.trade?.id;
  balanceAfter = r.json?.balance_usd;
  check("trade row returned", !!tradeId);
  check("balance debited by exactly the stake",
        moneyDiffCents(balanceBefore, balanceAfter) === toCents(STAKE),
        `${balanceBefore} -> ${balanceAfter} (stake ${STAKE})`);
  check("market state version incremented", Number(r.json?.market_state?.version) >= 1);

  /* double-click / retry */
  const r2 = await post("/api/play/trade", body);
  check("double submit -> 200 replayed", r2.status === 200 && r2.json?.replayed === true,
        `got ${r2.status} replayed=${r2.json?.replayed}`);
  check("double submit returns the SAME trade", r2.json?.trade?.id === tradeId);
  check("double submit moved no money", moneyEq(r2.json?.balance_usd, balanceAfter),
        `${balanceAfter} -> ${r2.json?.balance_usd}`);
}

/* 8 — a body wallet must be ignored */
step(8, "Body-supplied wallet is ignored (identity comes from the session)");
{
  const other = bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey));
  const r = await post("/api/play/state", { wallet: other, market_address: MARKET });
  check("state still resolves OUR wallet, not the body's",
        r.json?.account?.wallet_address === WALLET,
        `got ${r.json?.account?.wallet_address}`);
}

/* 9 — history */
step(9, "POST /api/play/history");
{
  const r = await post("/api/play/history", { limit: 10 });
  check("returns 200", r.status === 200, JSON.stringify(r.json));
  const rows = r.json?.trades || [];
  check("our trade appears exactly once",
        rows.filter((t) => t.id === tradeId).length === 1);
  const t = rows.find((x) => x.id === tradeId);
  if (t) {
    check("status is open", t.status === "open");
    check("stake matches", moneyEq(t.stake_usd, STAKE));
    check("season_id stamped at trade time", !!t.season_id);
    check("trade_date stamped at trade time", !!t.trade_date);
    console.log(`        trade ${t.id}\n        outcome=${t.outcome_index} ` +
                `shares=${t.shares} entry_supply=${t.entry_supply} season=${t.season_id}`);
  }
}

/* 10 — profile: grouping, P&L, and the owner-only balance */
step(10, "POST /api/play/profile (grouped positions + privacy)");
{
  // A SECOND buy on the SAME outcome must aggregate into ONE position, and a
  // buy on a DIFFERENT outcome must stay a SEPARATE position.
  const OTHER = OUTCOME === 0 ? 1 : 0;
  await post("/api/play/trade", {
    market_address: MARKET, outcome_index: OUTCOME,
    stake_usd: STAKE, client_trade_id: randomUUID(),
  });
  const otherBuy = await post("/api/play/trade", {
    market_address: MARKET, outcome_index: OTHER,
    stake_usd: STAKE, client_trade_id: randomUUID(),
  });
  check("second outcome bought (setup)", otherBuy.status === 201,
        `got ${otherBuy.status} ${JSON.stringify(otherBuy.json)}`);

  const r = await post("/api/play/profile", { wallet: WALLET });
  check("returns 200", r.status === 200, JSON.stringify(r.json));
  const p = r.json?.profile || {};
  const positions = p.positions || [];

  check("owner sees a balance", p.is_owner === true && p.balance_usd != null,
        `is_owner=${p.is_owner} balance=${p.balance_usd}`);
  check("identity fields are present",
        "username" in p && "avatar_url" in p, JSON.stringify(Object.keys(p)));
  check("raw trade count counts every buy", p.trade_count === 3,
        `trade_count = ${p.trade_count}`);

  const mine = positions.filter((x) => x.market_address === MARKET);
  check("three buys collapse into TWO positions on this market",
        mine.length === 2, `got ${mine.length}: ${JSON.stringify(mine.map((x) => x.outcome_index))}`);
  check("position_count is the GROUPED count, not the raw one",
        p.position_count === positions.length && p.position_count < p.trade_count,
        `position_count=${p.position_count} trade_count=${p.trade_count}`);

  const same = mine.find((x) => x.outcome_index === OUTCOME);
  const opposite = mine.find((x) => x.outcome_index === OTHER);
  check("same-outcome buys aggregate their stake",
        !!same && moneyDiffCents(same.total_stake_usd, STAKE) === toCents(STAKE),
        `total_stake_usd = ${same?.total_stake_usd} (2 x ${STAKE})`);
  check("same-outcome group reports 2 buys", same?.trade_count === 2,
        `trade_count = ${same?.trade_count}`);
  check("the opposite outcome stays a SEPARATE position",
        !!opposite && moneyEq(opposite.total_stake_usd, STAKE),
        `total_stake_usd = ${opposite?.total_stake_usd}`);

  check("open positions carry NO realized P&L",
        mine.every((x) => x.status === "open" && x.realized_pnl_usd === null &&
                          x.payout_usd === null),
        JSON.stringify(mine.map((x) => [x.status, x.realized_pnl_usd, x.payout_usd])));
  check("total realized P&L excludes open positions",
        moneyEq(p.realized_pnl_usd, "0"), `realized_pnl_usd = ${p.realized_pnl_usd}`);
  check("positions carry the market title", mine.every((x) => "market_title" in x));

  // Nothing account-scoped or internal may cross the wire.
  const leaked = JSON.stringify(r.json).match(
    /account_id|client_trade_id|privy_user_id|entry_supply|quoted_cost_usd|season_id|balance_before/
  );
  check("no internal ids / ledger / session fields exposed", leaked === null,
        `leaked: ${leaked?.[0]}`);

  /* PUBLIC read of the SAME wallet — no cookie */
  const pub = await post("/api/play/profile", { wallet: WALLET }, { withCookie: false });
  check("public read returns 200 (profiles are public by wallet)", pub.status === 200);
  check("public read does NOT leak the balance",
        pub.json?.profile?.balance_usd === null && pub.json?.profile?.is_owner === false,
        `balance=${pub.json?.profile?.balance_usd} is_owner=${pub.json?.profile?.is_owner}`);
  check("public read still shows the performance record",
        (pub.json?.profile?.positions || []).length === positions.length);

  /* ANOTHER wallet's profile, read WITH our cookie — the body must not
     grant ownership of someone else's account. */
  const stranger = bs58.encode(Buffer.from(nacl.sign.keyPair().publicKey));
  const other = await post("/api/play/profile", { wallet: stranger });
  check("a body wallet cannot claim ownership of another account",
        other.json?.profile?.is_owner === false &&
          other.json?.profile?.balance_usd === null,
        `is_owner=${other.json?.profile?.is_owner} balance=${other.json?.profile?.balance_usd}`);
  check("an unknown wallet returns a valid, zeroed profile",
        other.status === 200 &&
          (other.json?.profile?.positions || []).length === 0 &&
          other.json?.profile?.trade_count === 0,
        JSON.stringify(other.json?.profile));

  /* refresh the balance the later steps compare against */
  const s = await post("/api/play/state", {});
  balanceAfter = s.json?.account?.balance_usd;
}

/* 11 — insufficient balance */
step(11, "Overspend is rejected");
{
  const r = await post("/api/play/trade", {
    market_address: MARKET, outcome_index: OUTCOME,
    stake_usd: "999999", client_trade_id: randomUUID(),
  });
  check("stake above balance -> 400", r.status === 400, `got ${r.status} ${JSON.stringify(r.json)}`);
  const after = await post("/api/play/state", {});
  check("balance unchanged after the failed trade",
        moneyEq(after.json?.account?.balance_usd, balanceAfter),
        `${balanceAfter} -> ${after.json?.account?.balance_usd}`);
}

/* 12 — logout */
step(12, "POST /api/play/auth/logout");
{
  const r = await post("/api/play/auth/logout", {});
  check("returns 200", r.status === 200);
  const cleared = (r.setCookie || []).find((c) => c.startsWith("play_session="));
  check("cookie cleared (Max-Age=0)", !!cleared && /Max-Age=0/i.test(cleared), cleared || "");
}

/* -------------------------------- summary -------------------------------- */

console.log(`\n${"=".repeat(70)}`);
console.log(`  ${PASS} passed, ${FAIL} failed`);
console.log(`${"=".repeat(70)}`);
console.log(
  `\n  Wallet used: ${WALLET}\n` +
    `  Trade id:    ${tradeId}\n\n` +
    `  Admin-authenticated routes are NOT covered here (they need an\n` +
    `  admin_session cookie). See docs/play-mode-dev-validation.md §9\n` +
    `  for settlement and season rollover.\n\n` +
    `  Clean up this run's data on DEV with:\n` +
    `    delete from play_ledger  where account_id in (select id from play_accounts where wallet_address = '${WALLET}');\n` +
    `    delete from play_trades  where account_id in (select id from play_accounts where wallet_address = '${WALLET}');\n` +
    `    delete from play_accounts where wallet_address = '${WALLET}';\n`
);

process.exit(FAIL === 0 ? 0 : 1);
