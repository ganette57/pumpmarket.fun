const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

const overlay = source("../src/components/LiveTradeSuccessOverlay.tsx");
const viewer = source("../src/app/live/[id]/page.tsx");
const feed = source("../src/app/live/page.tsx");
const playSheet = source("../src/components/play/PlayLiveBuySheet.tsx");
const playPanel = source("../src/components/PlayTradingPanel.tsx");
const activityRenderer = source("../src/components/LiveMobileContent.tsx");

// One shared LIVE-only renderer/hook is mounted in both LIVE surfaces.
assert.match(overlay, /export default function LiveTradeSuccessOverlay/);
assert.match(overlay, /export function useLiveTradeSuccess/);
assert.match(viewer, /<LiveTradeSuccessOverlay success=\{tradeSuccess\}/);
assert.match(feed, /<LiveTradeSuccessOverlay success=\{tradeSuccess\}/);
assert.match(source("../src/app/trade/[id]/page.tsx"), /LiveTradeSuccessOverlay/);

// REAL confirmation is downstream of the awaited confirmed send, not the
// TradingPanel/MobileBuySheet click handler.
for (const [name, page] of [["viewer", viewer], ["feed", feed]]) {
  const confirmedAt = page.indexOf("txSig = await sendSignedTx");
  const successAt = page.indexOf('mode: "real"', confirmedAt);
  assert(confirmedAt >= 0 && successAt > confirmedAt, `${name}: REAL success follows confirmed send`);
  assert.match(page, /if \(side === "buy"\) \{[\s\S]*showTradeSuccess\(\{[\s\S]*mode: "real"/);
}

// PLAY callbacks expose only values returned by the successful trade response.
assert.match(playSheet, /const res = await playClient\.trade\([\s\S]*onTraded\?\.\(\{/);
assert.match(playSheet, /shares: Math\.max\(0, Number\(res\.trade\?\.shares\)/);
assert.match(playSheet, /stakeUsd: res\.trade\?\.stake_usd/);
assert.match(playPanel, /const res = await playClient\.trade\([\s\S]*onTraded\?\.\(\{/);
assert.match(viewer, /onTraded=\{\(\{ outcomeName, shares, stakeUsd \}\) =>[\s\S]*mode: "play"/);
assert.match(feed, /onTraded=\{\(\{ outcomeName, shares, stakeUsd \}\) =>[\s\S]*mode: "play"/);

// Visual contract: non-blocking, 2.3s enter/hold/exit, newest trade replaces
// the prior one, and motion can be disabled without hiding the confirmation.
assert.match(overlay, /const DISPLAY_MS = 2300/);
assert.match(overlay, /pointer-events-none fixed inset-0/);
assert.match(overlay, /scale\(\.9\)/);
assert.match(overlay, /scale\(1\.03\)/);
assert.match(overlay, /TRADE PLACED/);
assert.match(overlay, /prefers-reduced-motion:reduce/);
assert.match(overlay, /if \(timerRef\.current\) clearTimeout/);
assert.match(overlay, /mode === "play"[\s\S]*`\$\$\{compactNumber/);
assert.match(overlay, /`\$\{compactNumber\(success\.amount, 4\)\} SOL`/);

// STEP 3 incoming activity and WIN/LOSS result components remain separate.
assert.match(activityRenderer, /export function LiveTradeActivityPopups/);
assert.doesNotMatch(overlay, /LiveTradeActivityPopups|FlashMarketResultModal/);
assert.match(viewer, /<FlashMarketResultModal/);
assert.match(feed, /<FlashMarketResultModal/);

console.log("PASS: confirmed REAL/PLAY LIVE success uses one non-blocking reduced-motion overlay without touching activity or result UI");
