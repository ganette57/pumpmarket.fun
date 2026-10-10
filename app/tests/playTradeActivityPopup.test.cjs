const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

const activity = {};
new Function("exports", ts.transpileModule(source("../src/lib/liveTradeActivity.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(activity);

const hook = source("../src/hooks/useTradeActivityPopups.ts");
const renderer = source("../src/components/LiveMobileContent.tsx");
const liveViewer = source("../src/app/live/[id]/page.tsx");
const liveFeed = source("../src/app/live/page.tsx");
const tradePage = source("../src/app/trade/[id]/page.tsx");
const snapshotProvider = source("../src/components/mode/MarketSnapshotProvider.tsx");
const coreMigration = source("../supabase/migrations/20260721_play_mode_core.sql");

const row = {
  id: "play-trade-1",
  outcome_index: 0,
  outcome_name: "YES",
  side: "buy",
  shares: "100.25",
  stake_usd: "25.50",
  created_at: "2026-10-10T10:00:00.000Z",
  trader_label: "abcd…wxyz",
};
const normalized = activity.normalizePlayTradeActivity(row, " play-market ", ["YES", "NO"]);
assert.equal(normalized.market_address, "play-market");
assert.equal(normalized.activity_mode, "play");
assert.equal(normalized.id, row.id, "authoritative play_trades PK is the stable ID");
assert.equal(normalized.user_label, "abcd…wxyz");
assert.equal(normalized.outcome_name, "YES");
assert.equal(normalized.shares, 100.25);
assert.equal(normalized.cost, 25.5);
assert.equal(normalized.cost_currency, "USD");

let queue = activity.enqueueLiveTradeActivity([], normalized, "play-market", 1, "play");
assert.deepEqual(queue.map((item) => item.id), [row.id], "current PLAY market enters queue");
assert.strictEqual(
  activity.enqueueLiveTradeActivity(queue, { ...normalized, id: "other", market_address: "other" }, "play-market", 2, "play"),
  queue,
  "unrelated market is rejected",
);
assert.strictEqual(
  activity.enqueueLiveTradeActivity(queue, normalized, "play-market", 3, "play"),
  queue,
  "stable row ID deduplicates local/shared observation",
);
assert.strictEqual(
  activity.enqueueLiveTradeActivity(queue, { ...normalized, id: "real", activity_mode: "real" }, "play-market", 4, "play"),
  queue,
  "REAL event cannot leak into PLAY mode",
);
assert.deepEqual(
  activity.collectUnseenLiveTrades([normalized], null).newTrades,
  [],
  "initial PLAY history establishes a baseline",
);
const baseline = activity.collectUnseenLiveTrades([normalized], null);
const next = { ...normalized, id: "play-trade-2" };
assert.deepEqual(
  activity.collectUnseenLiveTrades([next, normalized], baseline.seenIds).newTrades.map((item) => item.id),
  [next.id],
  "only newly observed PLAY rows become popups",
);
for (let index = 2; index <= 5; index += 1) {
  queue = activity.enqueueLiveTradeActivity(queue, { ...normalized, id: `play-${index}` }, "play-market", index, "play");
}
assert.deepEqual(queue.map((item) => item.id), ["play-3", "play-4", "play-5"], "max three retained");

const custom = activity.normalizePlayTradeActivity(
  { ...row, id: "custom", outcome_index: 2, outcome_name: null },
  "play-market",
  ["Alpha", "Beta", "Draw"],
);
assert.equal(custom.outcome_name, "Draw");
assert.equal(custom.is_yes, null, "custom outcomes keep neutral semantics");
assert.equal(activity.normalizePlayTradeActivity({ ...row, trader_label: "Player" }, "play-market", []).user_label, null);

assert.match(hook, /usePlayMarketActivity\(address,/);
assert.match(hook, /collectUnseenLiveTrades/);
assert.match(hook, /normalizePlayTradeActivity/);
assert.match(hook, /mode !== "real"/);
assert.match(hook, /mode !== "play"/);
assert.match(hook, /active\.mode !== expectedMode \|\| active\.address !== address/);
assert.match(hook, /const DISMISS_MS = 4000/);
assert.doesNotMatch(hook, /setInterval|setTimeout\([^,]+,\s*1500/);
assert.match(snapshotProvider, /const PLAY_POLL_MS = 1500/);
assert.match(coreMigration, /revoke all on public\.play_trades\s+from anon, authenticated/);
assert.doesNotMatch(coreMigration, /ALTER PUBLICATION[^;]*play_trades/i);

for (const [name, page] of [["LIVE viewer", liveViewer], ["LIVE feed", liveFeed], ["Trade", tradePage]]) {
  assert.match(page, /useTradeActivityPopups\(/, `${name} uses the shared mode-aware source`);
  assert.match(page, /<LiveTradeActivityPopups trades=/, `${name} reuses the shared renderer`);
}
assert.match(renderer, /trade\.cost_currency === "USD" \? "\$"/);
assert.match(renderer, /trade\.user_label \|\|/);

console.log("PASS: PLAY activity reuses the shared popup queue with baseline, mode/market isolation, USD and stable-ID dedupe");
