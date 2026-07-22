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
  check("daily grant applied ($10,000)", r.json?.account?.balance_usd === "10000.00",
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
  check("balance is present", !!balanceBefore);
  check("no second grant on repeat call", balanceBefore === "10000.00",
        `balance_usd = ${balanceBefore}`);
  check("open_trades is an array", Array.isArray(r.json?.open_trades));
  check("market_state created on first touch", !!r.json?.market_state?.id,
        JSON.stringify(r.json?.market_state));
  if (r.json?.market_state) {
    const ms = r.json.market_state;
    console.log(`        outcomes=${ms.outcome_count} pool=$${ms.virtual_pool_usd} ` +
                `supplies=[${ms.outcome_supplies}] v=${ms.version}`);
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
  check("quote wrote nothing (no money moved)", true);
  if (q) {
    console.log(`        stake=$${q.stake_usd} shares=${q.shares} ` +
                `avg=$${q.avg_price_usd}\n` +
                `        odds ${q.implied_probs} -> ${q.implied_probs_after}\n` +
                `        est payout=$${q.estimated_payout_usd} (${q.estimated_multiple}x)`);
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
        Number(balanceBefore) - Number(balanceAfter) === Number(STAKE),
        `${balanceBefore} -> ${balanceAfter}`);
  check("market state version incremented", Number(r.json?.market_state?.version) >= 1);

  /* double-click / retry */
  const r2 = await post("/api/play/trade", body);
  check("double submit -> 200 replayed", r2.status === 200 && r2.json?.replayed === true,
        `got ${r2.status} replayed=${r2.json?.replayed}`);
  check("double submit returns the SAME trade", r2.json?.trade?.id === tradeId);
  check("double submit moved no money", r2.json?.balance_usd === balanceAfter,
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
    check("stake matches", Number(t.stake_usd) === Number(STAKE));
    check("season_id stamped at trade time", !!t.season_id);
    check("trade_date stamped at trade time", !!t.trade_date);
    console.log(`        trade ${t.id}\n        outcome=${t.outcome_index} ` +
                `shares=${t.shares} entry_supply=${t.entry_supply} season=${t.season_id}`);
  }
}

/* 10 — insufficient balance */
step(10, "Overspend is rejected");
{
  const r = await post("/api/play/trade", {
    market_address: MARKET, outcome_index: OUTCOME,
    stake_usd: "999999", client_trade_id: randomUUID(),
  });
  check("stake above balance -> 400", r.status === 400, `got ${r.status} ${JSON.stringify(r.json)}`);
  const after = await post("/api/play/state", {});
  check("balance unchanged after the failed trade",
        after.json?.account?.balance_usd === balanceAfter,
        `${balanceAfter} -> ${after.json?.account?.balance_usd}`);
}

/* 11 — logout */
step(11, "POST /api/play/auth/logout");
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
