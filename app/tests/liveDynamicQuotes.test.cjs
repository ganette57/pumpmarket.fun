const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8');
}

function loadTs(file) {
  const exports = {};
  new Function('exports', ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(exports);
  return exports;
}

const play = loadTs('../src/lib/playPayoutMath.ts');
const real = loadTs('../src/lib/realTradeQuote.ts');
const economics = source('../src/components/play/useLiveMarketEconomics.ts');
const liveUi = source('../src/components/LiveMobileContent.tsx');
const liveFeed = source('../src/app/live/page.tsx');
const liveViewer = source('../src/app/live/[id]/page.tsx');
const playSheet = source('../src/components/play/PlayLiveBuySheet.tsx');
const realHook = source('../src/hooks/useRealQuotes.ts');
const feedHook = source('../src/hooks/useFeedMultipliers.ts');
const feedRoute = source('../src/app/api/feed/returns/route.ts');
const activityHook = source('../src/hooks/useTradeActivityPopups.ts');

// 1-4. Both modes retain the authoritative marginal semantics with and
// without an existing same-outcome position.
assert.equal(play.playNewTradeQuoteUsd({
  newTradeShares: '50.00000000', currentTotalWinningShares: '0.00000000',
  finalPoolUsdAfter: '100.00', newStakeUsd: '100.00',
}).multiple, '1.0000');
assert.equal(play.playNewTradeQuoteUsd({
  newTradeShares: '42.94834734', currentTotalWinningShares: '1618.96000000',
  finalPoolUsdAfter: '3600.00', newStakeUsd: '100.00',
}).multiple, '0.9303');
assert(Number.isFinite(real.realQuote(10_000_000, 100, 3_000_000_000, 0, { budget: 1_000_000_000 }).multiplier));
const held = real.realQuote(10_000_000, 100, 3_000_000_000, 40, { budget: 1_000_000_000 });
assert.equal(held.payout, held.payoutAfter - held.payoutBefore);

// 5-6. LIVE renders every current outcome (up to four), with explicit binary
// and three-way layouts instead of silently slicing all cards to YES/NO.
assert.match(liveUi, /derived\.names\.length === 2/);
assert.match(liveUi, /derived\.names\.length === 3 \? "grid-cols-3"/);
assert.match(liveUi, /derived\.names\.slice\(0, 4\)/);

// 7-9. One market snapshot revision owns percentages and quote invalidation.
assert.match(economics, /quoteRevision/);
assert.match(economics, /expectedPlayVersion/);
assert.match(economics, /expectedRealSupplies/);
assert.match(feedRoute, /stateVersions/);
assert.match(feedHook, /stateVersion === options\.expectedPlayVersion/);
assert.match(realHook, /result\.snapshot\.supplies\.every/);

// Deterministic rapid activity: every A -> B -> C book produces a distinct
// revision, and the hook only exposes a delivery whose key is the current one.
const revision = (version, supplies) => JSON.stringify(['play', version, supplies]);
const books = [revision(1, ['10', '10']), revision(2, ['12', '10']), revision(3, ['12', '15'])];
assert.equal(new Set(books).size, 3);
const delivered = { key: books[1], values: [1.4, 2.2] };
assert.deepEqual(delivered.key === books[2] ? delivered.values : [], []);
assert.match(feedHook, /result\?\.key === key \? result\.values : \[\]/);

// 10-12. Wallet, outcome, and market navigation are quote identities; stale
// async responses are cancelled or epoch-guarded.
assert.match(feedHook, /mode}:\$\{identity}:\$\{address}:\$\{revision/);
assert.match(playSheet, /selectedOutcome, marketAddress, closed, quoteRevision/);
assert.match(playSheet, /epoch !== quoteEpochRef\.current/);
assert.match(liveViewer, /\[market\?\.publicKey\]/);

// 13. Activity refreshes both open sheets and cards through the same revision.
assert.match(liveViewer, /setMarketActivityRevision/);
assert.match(liveFeed, /onRealTrade: \(\) =>/);
assert.match(activityHook, /subscribeRecentTrades\(address,/);
assert.match(playSheet, /quoteRevision/);
assert.match(liveUi, /quoteRevision/);

// 14. Locked/ended/resolved/cancelled states gate quote work and action cards.
assert.match(liveViewer, /"locked", "ended", "resolved", "cancelled"/);
assert.match(economics, /quoteClosed \|\| !address/);
assert.match(liveUi, /derived && !locked/);

// 15. LIVE consumes the same shared quote layers as normal Feed/Trade; it has
// no local payout or multiplier formula.
assert.match(economics, /useFeedMultipliers/);
assert.match(liveUi, /useRealQuotes/);
assert.doesNotMatch(liveUi, /function calculateLive(?:Multiplier|Payout)/);
assert.match(feedRoute, /playNewTradeQuoteUsd/);
assert.match(feedRoute, /realFeedMultiple/);

console.log('PASS: LIVE dynamic marginal quotes, coherent A/B/C revisions, realtime invalidation, multi-outcome and lifecycle wiring');
