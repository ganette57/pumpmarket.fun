const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const payout = {};
new Function('exports', ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/playPayoutMath.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText)(payout);

// Exact requested-style example: the current position owns all winning shares.
assert.equal(payout.playCurrentPositionPayoutUsd({
  tradeShares: ['100.00000000'],
  totalWinningShares: '100.00000000',
  finalPoolUsd: '11320.00',
}), '11320.00');

// Settlement truncates each buy before summing; never collapse these first.
assert.equal(payout.playCurrentPositionPayoutUsd({
  tradeShares: ['100.00000000', '50.00000000'],
  totalWinningShares: '300.00000000',
  finalPoolUsd: '11320.00',
}), '5659.99');
assert.equal(payout.playCurrentPositionPayoutUsd({
  tradeShares: [],
  totalWinningShares: '300.00000000',
  finalPoolUsd: '11320.00',
}), null);

console.log('PASS: current PLAY payout, exact full-pool example, per-trade truncation, zero position');
