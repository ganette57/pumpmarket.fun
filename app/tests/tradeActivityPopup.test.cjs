const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

const tradePage = source("../src/app/trade/[id]/page.tsx");
const shared = source("../src/components/LiveMobileContent.tsx");
const sharedHook = source("../src/hooks/useTradeActivityPopups.ts");
const activity = {};
new Function("exports", ts.transpileModule(source("../src/lib/liveTradeActivity.ts"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(activity);

const currentMarket = "trade-market";
const currentTrade = { id: "current", market_address: currentMarket, is_buy: true };
let queue = activity.enqueueLiveTradeActivity([], currentTrade, currentMarket, 1);
assert.deepEqual(queue.map((trade) => trade.id), ["current"]);
assert.strictEqual(
  activity.enqueueLiveTradeActivity(
    queue,
    { id: "unrelated", market_address: "different-market", is_buy: true },
    currentMarket,
    2,
  ),
  queue,
  "unrelated markets are rejected",
);
assert.strictEqual(
  activity.enqueueLiveTradeActivity(queue, currentTrade, currentMarket, 3),
  queue,
  "duplicate transaction IDs are rejected",
);
for (let index = 2; index <= 5; index += 1) {
  queue = activity.enqueueLiveTradeActivity(
    queue,
    { id: `current-${index}`, market_address: currentMarket, is_buy: true },
    currentMarket,
    index,
  );
}
assert.deepEqual(queue.map((trade) => trade.id), ["current-3", "current-4", "current-5"]);
assert.deepEqual(
  activity.collectUnseenLiveTrades([currentTrade], null).newTrades,
  [],
  "opening Trade establishes a ticker baseline without historical replay",
);

assert.match(tradePage, /LiveTradeActivityPopups/);
assert.match(tradePage, /useTradeActivityPopups\(\{/);
assert.match(sharedHook, /subscribeRecentTrades\(address,/);
assert.match(sharedHook, /const DISMISS_MS = 4000/);
assert.equal(
  (tradePage.match(/useTradeActivityPopups\(\{/g) || []).length,
  1,
  "Trade page mounts one shared activity source",
);

assert.match(
  tradePage,
  /relative my-2 flex min-h-\[180px\][\s\S]*MobileProbabilityChart[\s\S]*<LiveTradeActivityPopups trades=\{tradeActivityToasts\}/,
  "mobile reuses the shared popup inside its relative chart wrapper",
);
assert.match(
  tradePage,
  /relative bg-black border border-gray-800 rounded-xl p-5 md:p-6[\s\S]*<LiveTradeActivityPopups trades=\{tradeActivityToasts\}/,
  "desktop reuses the shared popup inside the chart card",
);

assert.doesNotMatch(tradePage, /TradeBuyPopOverlay/);
assert.equal(
  fs.existsSync(path.join(__dirname, "../src/components/TradeBuyPopOverlay.tsx")),
  false,
  "legacy two-second polling popup implementation is removed",
);
assert.match(shared, /export function LiveTradeActivityPopups/);

console.log("PASS: Trade reuses shared LIVE activity queue and chart overlay without legacy polling");
