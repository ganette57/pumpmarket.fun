const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const quote = {};
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/realTradeQuote.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(quote);

// Frozen pre-refactor TradingPanel reference, independent of the shared helper.
function previousPanel(base, supply, pool, held, shares) {
  const cost = shares * (base + supply * 1000);
  const platform = Math.floor(cost * 100 / 10000);
  const creator = Math.floor(cost * 200 / 10000);
  const totalPay = cost + platform + creator;
  const payout = (held + shares) / (supply + shares) * (pool + cost + creator);
  return { totalPay, payout, multiplier: (payout / 1e9) / (totalPay / 1e9) };
}
// Existing public WWE snapshot: one YES share, zero NO shares; no network or writes.
for (const [supply, held] of [[1, 1], [0, 0], [1, 0]]) {
  for (const input of [{ shares: 100 }, { budget: 1e9 }]) {
    const actual = quote.realQuote(1e7, supply, 15524400, held, input);
    const expected = previousPanel(1e7, supply, 15524400, held, actual.shares);
    for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key]);
    if ('budget' in input) {
      assert.equal(actual.shares, 97);
      assert(actual.totalPay <= input.budget);
      assert(quote.realBuyCost(1e7, supply, actual.shares + 1).totalPay > input.budget);
    }
  }
}
// Fee rounding, existing holdings, multi-outcome supplies, and amount boundaries.
for (const base of [10001, 1e7]) for (const supply of [0, 10, 60, 100000])
for (const held of [0, supply]) for (const shares of [1, 10, 96, 100, 1000000]) {
  const actual = quote.realQuote(base, supply, 821783400, held, { shares });
  const expected = previousPanel(base, supply, 821783400, held, shares);
  for (const key of Object.keys(expected)) assert.equal(actual[key], expected[key]);
}
for (const input of [{ shares: 0 }, { shares: NaN }, { budget: 1 }, { budget: Infinity }])
  assert.equal(quote.realQuote(1e7, 0, 1e7, 0, input), null);
assert.equal(quote.realQuote(1e7, 0, 0, 0, { shares: 100 }).multiplier, null);
assert.equal(quote.realQuote(1e7, 0, 1e7, NaN, { shares: 100 }), null);
console.log('PASS: TradingPanel regression, WWE holdings/zero holdings, budget boundary, fee rounding, invalid inputs');
