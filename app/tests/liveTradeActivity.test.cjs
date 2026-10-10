const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

const shared = source("../src/components/LiveMobileContent.tsx");
const viewer = source("../src/app/live/[id]/page.tsx");
const feed = source("../src/app/live/page.tsx");
const sessions = source("../src/lib/liveSessions.ts");
const ticker = source("../src/components/LiveBuysTicker.tsx");
const tickerRoute = source("../src/app/api/ticker/route.ts");
const sharedHook = source("../src/hooks/useTradeActivityPopups.ts");

const activity = {};
new Function("exports", ts.transpileModule(source("../src/lib/liveTradeActivity.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(activity);

const matching = { id: "matching", market_address: "  live-market  ", is_buy: true };
let queue = activity.enqueueLiveTradeActivity([], matching, "live-market", 1);
assert.equal(queue.length, 1, "matching REAL buy enters queue");
const afterUnrelated = activity.enqueueLiveTradeActivity(
  queue,
  { id: "other", market_address: "other-market", is_buy: true },
  "live-market",
  2,
);
assert.strictEqual(afterUnrelated, queue, "unrelated market trade is ignored");
const afterDuplicate = activity.enqueueLiveTradeActivity(queue, matching, "live-market", 3);
assert.strictEqual(afterDuplicate, queue, "transaction ID is deduplicated");
for (let index = 2; index <= 5; index += 1) {
  queue = activity.enqueueLiveTradeActivity(
    queue,
    { id: `trade-${index}`, market_address: "live-market", is_buy: true },
    "live-market",
    index,
  );
}
assert.deepEqual(queue.map((item) => item.id), ["trade-3", "trade-4", "trade-5"]);

const baseline = activity.collectUnseenLiveTrades(
  [{ id: "old", market_address: "live-market", is_buy: true }],
  null,
);
assert.deepEqual(baseline.newTrades, [], "initial ticker response is a baseline, not a replay");
const polled = activity.collectUnseenLiveTrades(
  [
    { id: "new", market_address: "live-market", is_buy: true },
    { id: "old", market_address: "live-market", is_buy: true },
  ],
  baseline.seenIds,
);
assert.deepEqual(polled.newTrades.map((trade) => trade.id), ["new"]);

const originalWindow = global.window;
const originalCustomEvent = global.CustomEvent;
global.window = new EventTarget();
global.CustomEvent = class CustomEvent extends Event {
  constructor(type, init) {
    super(type);
    this.detail = init?.detail;
  }
};
let bridgedQueue = [];
const unsubscribeBridge = activity.subscribePublishedLiveTradeActivity((trade) => {
  bridgedQueue = activity.enqueueLiveTradeActivity(
    bridgedQueue,
    trade,
    "live-market",
    bridgedQueue.length + 1,
  );
});
activity.publishLiveTradeActivity({
  id: "bridged",
  market_address: "live-market",
  is_buy: true,
});
assert.deepEqual(bridgedQueue.map((trade) => trade.id), ["bridged"]);
unsubscribeBridge();
global.window = originalWindow;
global.CustomEvent = originalCustomEvent;

assert.match(shared, /export function LiveTradeActivityPopups/);
assert.match(shared, /absolute left-3 top-\[54%\] z-\[70\]/);
assert.match(shared, /fm-live-trade-popup/);
assert.match(shared, /translate3d\(-22px,0,0\) scale\(\.94\)/);
assert.match(shared, /translate3d\(-12px,0,0\) scale\(\.98\)/);
assert.match(shared, /prefers-reduced-motion:reduce/);
assert.match(shared, /normalized === "YES"/);
assert.match(shared, /normalized === "NO"/);
assert.match(shared, /`Outcome \$\{trade\.outcome_index \+ 1\}`/);
assert.match(shared, /activityOverlay\?: ReactNode/);
assert.match(
  shared,
  /className=\{`absolute inset-x-0 \$\{STREAM_TOP\}[\s\S]*\{activityOverlay\}[\s\S]*STRUCTURED STACK/,
  "mobile popup is mounted inside the actual stream wrapper",
);
assert.doesNotMatch(sessions, /filter: `market_address=eq\./);
assert.match(sessions, /subscribePublishedLiveTradeActivity/);
assert.match(sessions, /if \(!isTradeForLiveMarket\(trade, expectedMarketAddress\)\) return/);
assert.match(sessions, /deliveredIds\.has\(trade\.id\)/);
assert.equal(
  (sessions.match(/\.channel\(`live_trades_/g) || []).length,
  1,
  "popup helper retains one Supabase channel",
);
assert.match(ticker, /collectUnseenLiveTrades/);
assert.match(ticker, /publishLiveTradeActivity\(trade\)/);
assert.match(tickerRoute, /market_address,user_address,is_buy,is_yes,shares,cost,outcome_index,outcome_name/);

for (const [name, page] of [
  ["viewer", viewer],
  ["feed", feed],
]) {
  assert.match(page, /<LiveTradeActivityPopups trades=\{activityToasts\}/, `${name} uses shared popup`);
  assert.match(page, /useTradeActivityPopups\(/, `${name} uses shared activity hook`);
}

assert.match(
  feed,
  /onRealTrade: \(\) => \{[\s\S]*loadSessionMarketSnapshot\(popupSession\)/,
  "feed keeps its existing REAL snapshot refresh callback"
);
assert.match(sharedHook, /const DISMISS_MS = 4000/);
assert.equal((sharedHook.match(/subscribeRecentTrades\(/g) || []).length, 1);
assert.doesNotMatch(sharedHook, /setInterval/);
assert.match(viewer, /<LiveTradeSuccessOverlay success=\{tradeSuccess\}/);
assert.match(viewer, /<LiveTradeActivityPopups trades=\{activityToasts\}/);

console.log("PASS: ticker-to-popup fallback bridge, matching queue, dedupe, cap and shared renderer");
