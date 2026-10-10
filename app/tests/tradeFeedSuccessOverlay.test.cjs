const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

const trade = source("../src/app/trade/[id]/page.tsx");
const feed = source("../src/app/page.tsx");
const feedSheet = source("../src/components/FeedTradeSheet.tsx");
const overlay = source("../src/components/LiveTradeSuccessOverlay.tsx");

// Trade mobile and desktop share one page-owned overlay/state instance.
assert.equal((trade.match(/<LiveTradeSuccessOverlay success=\{tradeSuccess\}/g) || []).length, 1);
assert.equal((trade.match(/useLiveTradeSuccess\(\)/g) || []).length, 1);
assert.match(trade, /<LiveTradeActivityPopups trades=\{tradeActivityToasts\}/);

// REAL BUY waits for the existing confirmed signature + state refresh path,
// clears the blocking progress modal, then shows the shared overlay. SELL
// retains its prior result modal and does not enter the overlay branch.
const confirmedAt = trade.indexOf("await waitForSigConfirmed(txSig)");
const refreshedAt = trade.indexOf("await loadMarket(id, true)", confirmedAt);
const realSuccessAt = trade.indexOf('mode: "real"', refreshedAt);
assert(confirmedAt >= 0 && refreshedAt > confirmedAt && realSuccessAt > refreshedAt);
assert.match(trade, /if \(side === "buy"\) \{[\s\S]*setTradeStep\("idle"\);[\s\S]*showTradeSuccess\(\{/);
assert.match(trade, /else \{[\s\S]*setTradeStep\("done"\)/);

// PLAY desktop and drawer both consume PlayTradingPanel's persisted-response
// callback; the drawer closes before the page-owned overlay is shown.
assert.equal((trade.match(/onTraded=\{\(\{ outcomeName, shares, stakeUsd \}\)/g) || []).length, 2);
assert.match(trade, /onTraded=\{\(\{ outcomeName, shares, stakeUsd \}\) => \{[\s\S]*setMobileTradeOpen\(false\);[\s\S]*showTradeSuccess/);

// Feed owns the overlay outside FeedTradeSheet, so closing/unmounting the
// sheet cannot destroy the 2.3-second confirmation.
assert.equal((feed.match(/<LiveTradeSuccessOverlay success=\{tradeSuccess\}/g) || []).length, 1);
assert.match(feed, /<LiveTradeSuccessOverlay success=\{tradeSuccess\} \/>[\s\S]*<FeedTradeSheet/);
assert.match(feed, /onTradeSuccess=\{showTradeSuccess\}/);

// PLAY and REAL callbacks occur only downstream of their authoritative
// execution calls and are emitted after the existing delayed sheet close.
const playExecAt = feedSheet.indexOf("const res = await playClient.trade");
const playNotifyAt = feedSheet.indexOf('mode: "play"', playExecAt);
assert(playExecAt >= 0 && playNotifyAt > playExecAt);
const realExecAt = feedSheet.indexOf("const txSig = await sendSignedTx");
const realNotifyAt = feedSheet.indexOf('mode: "real"', realExecAt);
assert(realExecAt >= 0 && realNotifyAt > realExecAt);
assert.match(feedSheet, /setTimeout\(\(\) => \{[\s\S]*onClose\(\);[\s\S]*onTradeSuccess\?\.\(\{[\s\S]*mode: "play"/);
assert.match(feedSheet, /setTimeout\(\(\) => \{[\s\S]*onClose\(\);[\s\S]*onTradeSuccess\?\.\(\{[\s\S]*mode: "real"/);

// No parallel visual implementation: the approved shared component remains
// the only success-overlay component and retains its exact timing/motion.
const componentNames = fs.readdirSync(path.join(__dirname, "../src/components"))
  .filter((name) => /TradeSuccessOverlay\.tsx$/.test(name));
assert.deepEqual(componentNames, ["LiveTradeSuccessOverlay.tsx"]);
assert.match(overlay, /const DISPLAY_MS = 2300/);
assert.match(overlay, /scale\(\.9\)/);
assert.match(overlay, /scale\(1\.03\)/);
assert.match(overlay, /prefers-reduced-motion:reduce/);

console.log("PASS: Trade and mobile Feed reuse the confirmed shared success overlay without replacing activity popups");
