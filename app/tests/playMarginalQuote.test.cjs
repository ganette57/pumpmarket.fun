const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const play = {};
new Function('exports', ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/playPayoutMath.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText)(play);

const payout = (shares, total, pool) => play.playProRataPayoutUsd({
  shares,
  totalWinningShares: total,
  finalPoolUsd: pool,
});
const quote = (newTradeShares, currentTotalWinningShares, finalPoolUsdAfter, newStakeUsd = '100.00') =>
  play.playNewTradeQuoteUsd({ newTradeShares, currentTotalWinningShares, finalPoolUsdAfter, newStakeUsd });

// A. Zero holdings: the only winning trade receives the whole post-trade pool.
assert.deepEqual(quote('50.00000000', '0.00000000', '100.00'), {
  payoutUsd: '100.00', multiple: '1.0000',
});

// B. Existing shares in the quoted outcome stay only in the denominator.
assert.deepEqual(quote('50.00000000', '100.00000000', '300.00'), {
  payoutUsd: '99.99', multiple: '0.9999',
});

// C. Holdings in another outcome never enter the quoted outcome numerator or denominator.
assert.deepEqual(quote('50.00000000', '0.00000000', '300.00'), {
  payoutUsd: '300.00', multiple: '3.0000',
});

// D. Multiple held outcomes: only market-wide shares in the selected outcome matter.
assert.deepEqual(quote('25.00000000', '75.00000000', '500.00'), {
  payoutUsd: '125.00', multiple: '1.2500',
});

// E. Barcelona-like production reproduction.
// Existing trades: 573.59 + 321.56 + connected wallet 723.81, pool $3,500.
// The former quote grouped 723.81 existing + 42.94834734 new shares and divided
// that whole-position payout by the new $100 stake.
assert.equal(payout('723.81000000', '1618.96000000', '3500.00'), '1564.79');
assert.equal(payout('766.75834734', '1661.90834734', '3600.00'), '1660.93');
assert.equal(payout('723.81000000', '1661.90834734', '3600.00'), '1567.90');
assert.deepEqual(quote('42.94834734', '1618.96000000', '3600.00'), {
  payoutUsd: '93.03', multiple: '0.9303',
});

// F. Arsenal/Leeds-like production reproduction.
// Existing Leeds trade: $100 / 49.88 shares. A 49.87-share new $100 trade
// reproduces the observed old $530.37 whole-position display.
assert.equal(payout('49.88000000', '1341.87000000', '7300.00'), '271.35');
assert.equal(payout('99.75000000', '1391.74000000', '7400.00'), '530.37');
assert.equal(payout('49.88000000', '1391.74000000', '7400.00'), '265.21');
assert.deepEqual(quote('49.87000000', '1341.87000000', '7400.00'), {
  payoutUsd: '265.16', multiple: '2.6516',
});

// G. Settlement truncates every trade independently. Exact 1/3 of $3 is
// $0.99 under PostgreSQL numeric division/truncation, never $1.00.
assert.deepEqual(quote('1.00000000', '2.00000000', '3.00', '1.00'), {
  payoutUsd: '0.99', multiple: '0.9900',
});
assert.equal(
  play.playCurrentPositionPayoutUsd({
    tradeShares: ['1.00000000', '1.00000000', '1.00000000'],
    totalWinningShares: '3.00000000',
    finalPoolUsd: '3.00',
  }),
  '2.97',
);

// H. Every purchase surface consumes the same quote fields. Feed converts the
// same shared result to a number; no surface owns a payout formula.
for (const file of [
  '../src/components/FeedTradeSheet.tsx',
  '../src/components/play/PlayLiveBuySheet.tsx',
  '../src/components/PlayTradingPanel.tsx',
  '../src/components/trade/MobileTradeOutcomes.tsx',
]) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert.match(source, /playClient\s*\.quote/);
  assert.match(source, /estimated_payout_usd/);
}
const feedRoute = fs.readFileSync(path.join(__dirname, '../src/app/api/feed/returns/route.ts'), 'utf8');
assert.match(feedRoute, /playNewTradeQuoteUsd/);

assert.equal(quote('0', '10', '100', '100'), null);
assert.equal(quote('10', '-1', '100', '100'), null);
assert.equal(quote('10', '10', 'bad', '100'), null);

console.log('PASS: marginal PLAY quote zero/same/other/multiple holdings, Barcelona, Arsenal-Leeds, per-trade cents, surface parity');
console.log('Barcelona: before $1564.79; new $100; old whole-position after $1660.93 / 16.6093x; new-trade $93.03 / 0.9303x');
console.log('Arsenal-Leeds: before $271.35; new $100; old whole-position after $530.37 / 5.3037x; new-trade $265.16 / 2.6516x');
