const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PublicKey } = require('@solana/web3.js');
const { BorshAccountsCoder, BN } = require('@coral-xyz/anchor');
const root = path.join(__dirname, '../src');
function load(file, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', code)(name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('.')) return load(path.join(path.dirname(file), name + '.ts'), mocks);
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks);
    return require(name);
  }, exports);
  return exports;
}
function harness(callback) {
  let cells = [], cursor = 0, pending = [], mounted = true, scheduled = false, props;
  const run = () => {
    if (!mounted) return;
    scheduled = false; cursor = 0; pending = [];
    api.value = callback(props);
    for (const effect of pending) effect();
  };
  const api = {
    react: {
      useState(initial) {
        const i = cursor++;
        if (!cells[i]) cells[i] = { value: initial };
        return [cells[i].value, next => {
          cells[i].value = typeof next === 'function' ? next(cells[i].value) : next;
          if (!scheduled && mounted) { scheduled = true; queueMicrotask(run); }
        }];
      },
      useEffect(effect, deps) {
        const i = cursor++, prev = cells[i];
        if (!prev || deps.some((dep, n) => dep !== prev.deps[n])) {
          cells[i] = { deps, cleanup: prev?.cleanup };
          pending.push(() => { cells[i].cleanup?.(); cells[i].cleanup = effect(); });
        }
      },
      useRef(initial) { const i = cursor++; return cells[i] ?? (cells[i] = { current: initial }); },
      useCallback(callback) { cursor++; return callback; },
    },
    render(next) { props = next; run(); return api.value; },
    unmount() { mounted = false; cells.forEach(cell => cell?.cleanup?.()); },
  };
  return api;
}
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
global.window = new EventTarget();
global.document = new EventTarget();
document.visibilityState = 'visible';

(async () => {
  const { realOpenPositionRows, onlyHeldPosition } = load('lib/realPositionDisplay.ts');
  const { playCurrentPositionPayoutUsd } = load('lib/playPayoutMath.ts');
  assert.equal(playCurrentPositionPayoutUsd({ tradeShares: ['100.00000000'], totalWinningShares: '200.00000000', finalPoolUsd: '14600.00' }), '7300.00');
  assert.equal(playCurrentPositionPayoutUsd({ tradeShares: ['100.00000000'], totalWinningShares: '200.00000000', finalPoolUsd: '16000.00' }), '8000.00');
  const position = { shares: [100, 0], net_cost_lamports: '1400000000', last_trade_ts: 1700000000 };
  const market = { q: [400, 100], status: { Open: {} }, outcome_names: ['Arsenal', 'Leeds'] };
  const rows = realOpenPositionRows('market', position, market, 7360000000, { question: 'Arsenal vs Leeds United' });
  assert.equal(rows[0].payoutLamports, 1840000000);
  assert.equal(rows[0].marketNetStakeLamports, 1400000000);
  assert.equal(rows[0].outcomeName, 'Arsenal');
  assert.equal(realOpenPositionRows('m', position, market, 8000000000)[0].payoutLamports, 2000000000);
  const multi = realOpenPositionRows('m', { ...position, shares: [100, 20] }, market, 7360000000);
  assert.equal(multi[0].heldOutcomeCount, 2);
  assert.equal(onlyHeldPosition(multi, p => p.shares), null);
  assert.equal(onlyHeldPosition([], p => p.shares), null);
  assert.equal(onlyHeldPosition(rows, p => p.shares), rows[0]);
  assert.equal(realOpenPositionRows('m', { ...position, net_cost_lamports: undefined }, market, 1)[0].marketNetStakeLamports, null);
  assert.equal(realOpenPositionRows('m', { ...position, net_cost_lamports: '-12' }, market, 1)[0].marketNetStakeLamports, -12);
  assert.deepEqual(realOpenPositionRows('m', position, { ...market, resolved: true }, 1), []);
  assert.deepEqual(realOpenPositionRows('m', { ...position, claimed: true }, market, 1), []);

  // Real IDL, discriminator and wallet filter byte offset (no RPC or wallet signing).
  const idl = require('../src/idl/funmarket_pump.json');
  const coder = new BorshAccountsCoder(idl);
  const wallet = new PublicKey(new Uint8Array(32).fill(1));
  const marketKey = new PublicKey(new Uint8Array(32).fill(2));
  const raw = await coder.encode('UserPosition', {
    market: marketKey, user: wallet, shares: [100, ...Array(9).fill(0)].map(n => new BN(n)),
    claimed: false, last_trade_ts: new BN(1700000000), net_cost_lamports: new BN(1400000000),
  });
  assert.equal(new PublicKey(raw.subarray(40, 72)).toBase58(), wallet.toBase58());
  assert.equal(coder.decode('UserPosition', raw).shares[0].toNumber(), 100);

  // PLAY: public holdings with no cookie, book changes, failed-request focus retry,
  // stale market/wallet/mode responses, and same-market position refresh.
  let playHook, pending = [], calls = [];
  const play = harness(input => playHook(input));
  playHook = load('components/play/usePlayPositionPayouts.ts', {
    react: play.react,
    '@/lib/playClient': { playClient: { profile: wallet => {
      calls.push(wallet); const d = deferred(); pending.push(d); return d.promise;
    } } },
  }).usePlayPositionPayouts;
  const input = { enabled: true, market: 'm', wallet: 'w', identity: null, revision: 1, balance: null };
  play.render(input);
  const p = payout => ({ market_address: 'm', outcome_index: 0, total_shares: '100', estimated_payout_usd: payout, status: 'open' });
  pending.shift().resolve({ positions: [p('7300.00')] }); await flush();
  assert.equal(play.value[0].estimated_payout_usd, '7300.00');
  play.render({ ...input, revision: 2 }); assert.deepEqual(play.value, []);
  pending.shift().resolve({ positions: [p('8000.00')] }); await flush();
  assert.equal(play.value[0].estimated_payout_usd, '8000.00');
  play.render({ ...input, wallet: 'other' }); assert.deepEqual(play.value, []);
  const late = pending.shift();
  play.render({ ...input, enabled: false }); late.resolve({ positions: [p('1.00')] }); await flush();
  assert.deepEqual(play.value, []);
  play.render({ ...input, market: 'different' });
  pending.shift().resolve({ positions: [p('7300.00')] }); await flush(); assert.deepEqual(play.value, []);
  play.render(input); pending.shift().reject(new Error('fixture network failure')); await flush();
  assert.deepEqual(play.value, []);
  window.dispatchEvent(new Event('focus'));
  pending.shift().resolve({ positions: [p('9000.00')] }); await flush();
  assert.equal(play.value[0].estimated_payout_usd, '9000.00');
  play.render({ ...input, balance: '8500.00' });
  pending.shift().resolve({ positions: [p('9000.00'), { ...p('12.00'), outcome_index: 1 }] }); await flush();
  assert.equal(onlyHeldPosition(play.value, p => Number(p.total_shares)), null);
  play.unmount();

  // Profile retains the shared PLAY watcher and refetches its authoritative
  // profile on book revisions (no per-card polling).
  let profilePlayHook, revision = '', profileFetches = 0, watches = 0, unwatches = 0;
  const playProfile = harness(wallet => profilePlayHook(wallet));
  const watchPlayMarket = () => { watches++; return () => { unwatches++; }; };
  profilePlayHook = load('components/play/usePlayProfile.ts', {
    react: playProfile.react,
    '@/components/mode/ModeProvider': { useTradingMode: () => ({ isPlay: true }) },
    '@/components/mode/MarketSnapshotProvider': {
      useMarketSnapshotActions: () => ({ watchPlayMarket }),
      useMarketSnapshotsRevision: () => revision,
    },
    '@/lib/playClient': { playClient: { profile: async () => {
      profileFetches++; return { positions: [p(profileFetches === 1 ? '7300.00' : '8000.00')] };
    } } },
  }).usePlayProfile;
  playProfile.render('w'); await flush(); assert.equal(watches, 1);
  revision = 'm:play:1'; playProfile.render('w'); await flush();
  revision = 'm:play:2'; playProfile.render('w'); await flush();
  assert.equal(profileFetches, 2);
  assert.equal(playProfile.value.profile.positions[0].estimated_payout_usd, '8000.00');
  playProfile.unmount(); assert.equal(unwatches, 1);

  // REAL Trade: websocket position refresh, missing accounts, slot ordering,
  // immediate clearing on wallet/mode changes and late response isolation.
  let realHook, listeners = [], reads = [], removed = [];
  const connection = {
    getAccountInfoAndContext() { const d = deferred(); reads.push(d); return d.promise; },
    onAccountChange(_, fn) { listeners.push(fn); return listeners.length; },
    removeAccountChangeListener(id) { removed.push(id); return Promise.resolve(); },
  };
  const owner = new PublicKey(new Uint8Array(32).fill(3));
  const real = harness(input => realHook(...input));
  realHook = load('hooks/useRealWalletPosition.ts', {
    react: real.react, '@solana/wallet-adapter-react': { useConnection: () => ({ connection }) },
    '@/idl/funmarket_pump.json': idl,
    '@/utils/solana': { PROGRAM_ID: owner, getUserPositionPDA: () => [marketKey] },
  }).useRealWalletPosition;
  const args = [marketKey.toBase58(), wallet.toBase58(), true];
  real.render(args);
  const info = { data: raw, owner };
  listeners[0](info, { slot: 2 }); await flush(); assert.equal(real.value[0], 100);
  reads.shift().resolve({ value: null, context: { slot: 1 } }); await flush(); assert.equal(real.value[0], 100);
  listeners[0](null, { slot: 3 }); await flush(); assert.deepEqual(real.value, []);
  real.render([args[0], owner.toBase58(), true]); assert.deepEqual(real.value, []);
  const old = reads.shift();
  real.render([args[0], args[1], false]);
  old.resolve({ value: info, context: { slot: 4 } }); await flush(); assert.deepEqual(real.value, []);
  assert.equal(removed.length, 2); real.unmount();

  // REAL Profile: wallet-filtered discovery, live market updates, holdings
  // refresh and subscription cleanup. All values are deterministic fixtures.
  let profileHook, changed, marketChanged, filters;
  let scanned = [{ account: { data: raw } }];
  const profileConnection = {
    getProgramAccounts(_, config) { filters = config.filters; return Promise.resolve(scanned); },
    onProgramAccountChange(_, fn) { changed = fn; return 50; },
    removeProgramAccountChangeListener() { return Promise.resolve(); },
    getMultipleAccountsInfoAndContext() { return Promise.resolve({ value: [{ owner, data: market, lamports: 7360000000 }], context: { slot: 1 } }); },
    onAccountChange(_, fn) { marketChanged = fn; return 51; },
    removeAccountChangeListener() { return Promise.resolve(); },
  };
  class FixtureCoder {
    memcmp(name) { return coder.memcmp(name); }
    decode(name, data) { return name === 'UserPosition' ? coder.decode(name, data) : data; }
  }
  const profile = harness(wallet => profileHook(wallet));
  profileHook = load('hooks/useRealOpenPositions.ts', {
    react: profile.react, '@solana/wallet-adapter-react': { useConnection: () => ({ connection: profileConnection }) },
    '@coral-xyz/anchor': { BorshAccountsCoder: FixtureCoder }, '@/idl/funmarket_pump.json': idl,
    '@/utils/solana': { PROGRAM_ID: owner }, '@/lib/activity': { fetchMarketsByAddresses: async () => [] },
    '@/lib/realPositionDisplay': { realOpenPositionRows },
  }).useRealOpenPositions;
  profile.render(wallet.toBase58()); await flush();
  assert.equal(filters[0].memcmp.offset, 0); assert.equal(filters[1].memcmp.offset, 40);
  assert.equal(profile.value.rows[0].payoutLamports, 1840000000);
  marketChanged({ owner, data: market, lamports: 8000000000 }, { slot: 2 }); await flush();
  assert.equal(profile.value.rows[0].payoutLamports, 2000000000);
  marketChanged({ owner, data: market, lamports: 1000000000 }, { slot: 1 }); await flush();
  assert.equal(profile.value.rows[0].payoutLamports, 2000000000);
  scanned = []; changed(); await flush(); assert.deepEqual(profile.value.rows, []);
  profile.render(owner.toBase58()); assert.equal(profile.value, null);
  profile.unmount();
  console.log('PASS: display/IDL, public PLAY toolbar, 0/1/multiple outcomes, market and position refresh, slot ordering, wallet/market/mode isolation');
  console.log('Fixtures: PLAY $7,300 → $8,000; REAL 1.84 → 2 SOL; recorded net stake 1.4 SOL (excluding fees). No network or trades.');
})().catch(error => { console.error(error); process.exitCode = 1; });
