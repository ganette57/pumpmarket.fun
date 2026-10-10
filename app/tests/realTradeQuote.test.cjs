const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const quote = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/realTradeQuote.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(quote);

// Independent mirrors of the existing buy rules and the on-chain grouped
// claim. These deliberately do not call the production helpers under test.
function buy(base, supply, shares) {
  const pricePerUnit = base + supply * 1000;
  const cost = shares * pricePerUnit;
  const platform = Math.floor(cost * 100 / 10000);
  const creator = Math.floor(cost * 200 / 10000);
  return { pricePerUnit, cost, platform, creator, totalPay: cost + platform + creator };
}
function groupedPayout(shares, pool, supply) {
  if (shares <= 0) return 0;
  return Number(BigInt(shares) * BigInt(pool) / BigInt(supply));
}
function expected(base, supply, pool, held, shares) {
  const b = buy(base, supply, shares);
  const payoutBefore = groupedPayout(held, pool, supply);
  const payoutAfter = groupedPayout(held + shares, pool + b.cost + b.creator, supply + shares);
  const payout = payoutAfter - payoutBefore;
  return { ...b, payoutBefore, payoutAfter, payout,
    multiplier: (payout / 1_000_000_000) / (b.totalPay / 1_000_000_000) };
}
function check(base, supply, pool, held, input) {
  const actual = quote.realQuote(base, supply, pool, held, input);
  assert(actual);
  const wanted = expected(base, supply, pool, held, actual.shares);
  for (const key of ['pricePerUnit', 'cost', 'totalPay', 'payoutBefore', 'payoutAfter', 'payout', 'multiplier']) {
    assert.equal(actual[key], wanted[key], key);
  }
  assert.equal(actual.fees.platform, wanted.platform);
  assert.equal(actual.fees.creator, wanted.creator);
  return actual;
}

// 1. Zero holdings: marginal and former total-position semantics converge.
const zero = check(10_000_000, 0, 3_886_200, 0, { shares: 100 });
assert.equal(zero.totalPay, 1_030_000_000);
assert.equal(zero.payoutBefore, 0);
assert.equal(zero.payoutAfter, 1_023_886_200);
assert.equal(zero.payout, 1_023_886_200);
assert.equal(zero.multiplier, 1_023_886_200 / 1_030_000_000);

// 2/5. Small same-outcome holding (Genoa-style all-supply position).
const small = check(10_000_000, 10, 821_783_400, 10, { shares: 100 });
assert.equal(small.payoutBefore, 821_783_400);
assert.equal(small.payoutAfter, 1_842_803_400);
assert.equal(small.payout, 1_021_020_000);

// 6. Large same-outcome holding: the known 60-share audit reproduction.
const large = check(10_000_000, 60, 821_783_400, 60, { shares: 100 });
assert.equal(large.cost, 1_006_000_000);
assert.deepEqual(large.fees, { platform: 10_060_000, creator: 20_120_000, total: 30_180_000 });
assert.equal(large.totalPay, 1_036_180_000);
assert.equal(large.payoutBefore, 821_783_400);
assert.equal(large.payoutAfter, 1_847_903_400);
assert.equal(large.payout, 1_026_120_000);
assert.equal(large.multiplier, 1.02612 / 1.03618);
assert(Math.abs(large.payoutAfter / large.totalPay - 1.7833806867532667) < 1e-15); // former display

// 3. Holdings only in another outcome: selected-outcome held=0, so the quote
// is identical to a wallet with no position in that outcome.
const otherOutcome = check(10_000_000, 60, 821_783_400, 0, { shares: 100 });
assert.equal(otherOutcome.payoutBefore, 0);
assert.equal(otherOutcome.payout, otherOutcome.payoutAfter);

// 4. Multiple held outcomes: only holdings at the selected index enter the
// grouped claim. The hook passes snapshot.holdings[i] for each outcome.
const multipleSelected = check(10_000_000, 60, 821_783_400, 10, { shares: 100 });
assert.equal(multipleSelected.payoutBefore, groupedPayout(10, 821_783_400, 60));
assert.notEqual(multipleSelected.payout, large.payout);

// 7. Feed/reference-budget quotes buy the maximum whole-share quantity within
// the budget and divide by that quantity's ACTUAL payment.
const budget = check(10_000_000, 1, 15_524_400, 0, { budget: 1_000_000_000 });
assert.equal(budget.shares, 97);
assert(budget.totalPay <= 1_000_000_000);
assert(quote.realBuyCost(10_000_000, 1, budget.shares + 1).totalPay > 1_000_000_000);
assert.equal(budget.multiplier,
  (budget.payout / 1_000_000_000) / (budget.totalPay / 1_000_000_000));

// 8/9. Fee floors and claim floors match integer on-chain arithmetic.
const rounded = check(10_001, 10, 821_783_401, 3, { shares: 1 });
assert.equal(rounded.fees.platform, Math.floor(rounded.cost / 100));
assert.equal(rounded.fees.creator, Math.floor(rounded.cost * 2 / 100));
assert(Number.isSafeInteger(rounded.payoutBefore));
assert(Number.isSafeInteger(rounded.payoutAfter));
assert(Number.isSafeInteger(rounded.payout));

// Broad boundaries preserve pricing, fees, whole-share selection and grouped
// settlement while checking both zero and existing holdings.
for (const base of [10001, 10_000_000]) for (const supply of [1, 10, 60, 100000])
for (const held of [0, supply]) for (const shares of [1, 10, 96, 100, 1000000]) {
  check(base, supply, 821_783_400, held, { shares });
}
for (const input of [{ shares: 0 }, { shares: NaN }, { budget: 1 }, { budget: Infinity }]) {
  assert.equal(quote.realQuote(10_000_000, 0, 10_000_000, 0, input), null);
}
assert.equal(quote.realQuote(10_000_000, 0, 0, 0, { shares: 100 }).multiplier, null);
assert.equal(quote.realQuote(10_000_000, 0, 10_000_000, NaN, { shares: 100 }), null);

// 10-14. Feed, Quick Trade, Trading Panel and passive Trade cards all route
// through realQuote/useRealQuotes; no component owns a competing formula.
const realHook = fs.readFileSync(path.join(__dirname, '../src/hooks/useRealQuotes.ts'), 'utf8');
assert.match(realHook, /realQuote\(snapshot\.base, s, snapshot\.pool, snapshot\.holdings\[i\], input\)/);
for (const file of [
  '../src/components/FeedTradeSheet.tsx',
  '../src/components/TradingPanel.tsx',
  '../src/components/trade/MobileTradeOutcomes.tsx',
  '../src/hooks/useFeedMultipliers.ts',
]) {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  assert.match(source, /useRealQuotes|realQuote/);
}
const feedRoute = fs.readFileSync(path.join(__dirname, '../src/app/api/feed/returns/route.ts'), 'utf8');
assert.match(feedRoute, /realFeedMultiple/);

// 15/16. Current-position Profile and Trade-toolbar payout keeps its grouped
// zero-purchase semantics and does not use the new-purchase delta.
assert.equal(quote.realCurrentPositionPayoutLamports(3_680_000_000, 200, 100), 1_840_000_000);
assert.equal(quote.realCurrentPositionPayoutLamports(3_680_000_000, 200, 0), null);
assert.equal(
  quote.realCurrentPositionPayoutLamports(3_680_000_000, 200, 100),
  quote.realPayoutLamports(3_680_000_000, 200, 0, 100, 0, 0),
);
const positionDisplay = fs.readFileSync(path.join(__dirname, '../src/lib/realPositionDisplay.ts'), 'utf8');
const tradePage = fs.readFileSync(path.join(__dirname, '../src/app/trade/[id]/page.tsx'), 'utf8');
assert.match(positionDisplay, /realCurrentPositionPayoutLamports/);
assert.match(tradePage, /realCurrentPositionPayoutLamports/);

console.log('PASS: REAL marginal grouped-position payout, zero/same/other/multiple holdings, small/large positions, fees, rounding, actual-spend budget, surface parity, current-position payout');
console.log(`60-share fixture: before=${large.payoutBefore}, pay=${large.totalPay}, after=${large.payoutAfter}, marginal=${large.payout}, old=${large.payoutAfter / large.totalPay}, corrected=${large.multiplier}`);
