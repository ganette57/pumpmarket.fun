const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function source(file) {
  return fs.readFileSync(path.join(__dirname, file), 'utf8');
}

const windows = {};
new Function('exports', ts.transpileModule(source('../src/lib/liveFlashWindows.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(windows);

for (const [fraction, expected] of [
  [1, 'green'], [0.600001, 'green'],
  [0.6, 'yellow'], [0.300001, 'yellow'],
  [0.3, 'yellow'], [0.299999, 'orange'], [0.100001, 'orange'],
  [0.1, 'red'], [0, 'red'], [Number.NaN, 'red'],
]) {
  assert.equal(windows.tradeWindowUrgency(fraction), expected, `${fraction} -> ${expected}`);
}

// The fraction is derived from the persisted trading window, not seconds.
const start = 1_000_000;
const lock = start + 100_000;
assert.equal(windows.deriveTradeWindowState({
  startedAtMs: start, lockAtMs: lock, endAtMs: lock + 50_000, nowMs: start + 39_000,
}).urgency, 'green');
assert.equal(windows.deriveTradeWindowState({
  startedAtMs: start, lockAtMs: lock, endAtMs: lock + 50_000, nowMs: start + 40_000,
}).urgency, 'yellow');
assert.equal(windows.deriveTradeWindowState({
  startedAtMs: start, lockAtMs: lock, endAtMs: lock + 50_000, nowMs: start + 70_001,
}).urgency, 'orange');
const locked = windows.deriveTradeWindowState({
  startedAtMs: start, lockAtMs: lock, endAtMs: lock + 50_000, nowMs: lock,
});
assert.equal(locked.open, false);
assert.equal(locked.fractionRemaining, 0);

const ui = source('../src/components/LiveMobileContent.tsx');
assert.match(ui, /fm-trade-green/);
assert.match(ui, /fm-trade-yellow/);
assert.match(ui, /fm-trade-orange/);
assert.match(ui, /fm-trade-red/);
assert.match(ui, /Trading locked · Watch only/);
assert.match(ui, /prefers-reduced-motion:reduce/);
assert.match(ui, /open \? `fm-trade-active fm-trade-/);

console.log('PASS: LIVE urgency thresholds, fraction-derived transitions, saturated shared animation and inert locked state');
