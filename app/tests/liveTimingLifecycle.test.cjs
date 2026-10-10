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

const windows = loadTs('../src/lib/liveFlashWindows.ts');
const lifecycle = loadTs('../src/lib/liveSessionLifecycle.ts');

const expected = new Map([
  [1, 45],
  [3, 135],
  [5, 240],
  [10, 480],
  [15, 720],
  [30, 1500],
]);

for (const [durationMin, tradeWindowSec] of expected) {
  assert.equal(windows.tradeWindowSecondsFor(durationMin), tradeWindowSec);
  const computed = windows.computeFlashMarketWindow(durationMin, 1_000_000);
  assert.equal(computed.tradeWindowSec, tradeWindowSec);
  assert.equal(computed.lockAt.getTime(), 1_000_000 + tradeWindowSec * 1000);
  assert.equal(computed.endAt.getTime(), 1_000_000 + durationMin * 60_000);
  assert.equal(
    windows.inferStartedAtMs(computed.lockAt.getTime(), computed.endAt.getTime()),
    1_000_000,
  );
}

const requiresResolution = lifecycle.linkedLiveMarketRequiresResolution;
assert.equal(requiresResolution({ marketAddress: null, market: null }), false);
assert.equal(requiresResolution({ marketAddress: 'linked', market: null }), true);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolutionStatus: 'open' } }), true);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolutionStatus: 'locked' } }), true);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolutionStatus: 'proposed' } }), false);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolved: true } }), false);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { cancelled: true } }), false);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolutionStatus: 'finalized' } }), false);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolutionStatus: 'resolved' } }), false);
assert.equal(requiresResolution({ marketAddress: 'linked', market: { resolutionStatus: 'cancelled' } }), false);

const create = source('../src/lib/liveMarketCreate.ts');
const hostControls = source('../src/components/LiveHostControls.tsx');
const statusRoute = source('../src/app/api/live-sessions/[id]/status/route.ts');
assert.match(create, /computeFlashMarketWindow/);
assert.match(create, /trading_lock_at: window\.lockAt\.toISOString\(\)/);
assert.match(hostControls, /s === "ended" && endDisabled/);
assert.match(hostControls, /Propose a result or cancel the linked market/);
assert.match(statusRoute, /newStatus === "ended" && session\.market_address/);
assert.match(statusRoute, /linkedLiveMarketRequiresResolution/);
assert.match(statusRoute, /Propose a result or cancel the linked market/);

console.log('PASS: LIVE windows and shared Ended guard for active, proposed, finalized, resolved and cancelled markets');
