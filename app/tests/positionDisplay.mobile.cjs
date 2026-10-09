// Read-only browser fixtures rendered from the actual components. No app API calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const app = path.resolve(__dirname, '..');
const output = process.env.POSITION_FIXTURE_DIR || '/tmp/position-payout-validation';
fs.mkdirSync(output, { recursive: true });
const modules = {};
function add(name, file, extra = '') {
  modules[name] = ts.transpileModule(fs.readFileSync(path.join(app, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText + extra;
}
add('@/lib/playClient', 'src/lib/playClient.ts');
add('play', 'src/components/play/PlayProfileView.tsx', '\nexports.Positions = PlayPositions;');
add('real', 'src/components/RealOpenPositions.tsx');
add('toolbar', 'src/components/trade/MobileMarketToolbar.tsx');
modules['lucide-react'] = fs.readFileSync(require.resolve('lucide-react'), 'utf8');
const cssInput = path.join(output, 'input.css');
fs.writeFileSync(cssInput, '@tailwind base;@tailwind components;@tailwind utilities;');
execFileSync(path.join(app, 'node_modules/.bin/tailwindcss'), ['-c', path.join(app, 'tailwind.config.js'), '-i', cssInput, '-o', path.join(output, 'style.css')], { cwd: app, stdio: 'pipe' });
const react = fs.readFileSync(require.resolve('react').replace('/index.js', '/umd/react.development.js'), 'utf8');
const dom = fs.readFileSync(require.resolve('react-dom').replace('/index.js', '/umd/react-dom.development.js'), 'utf8');
const glass = fs.readFileSync(path.join(app, 'src/components/trade/MobileMarketToolbar.module.css'), 'utf8');
const script = `
const source = ${JSON.stringify(modules)};
const cache = {};
function require(name) {
 if(name === 'react') return React;
 if(name === 'react/jsx-runtime') return { jsx: (type, props, key) => React.createElement(type,{...props,key}), jsxs: (type,props,key) => React.createElement(type,{...props,key}), Fragment: React.Fragment };
 if(name === '@/lib/resultPayload') return { buildPlayProfileShareInput: () => null };
 if(name === 'next/link') return { __esModule:true, default: ({children,...props}) => React.createElement('a',props,children) };
 if(name === './MobileMarketToolbar.module.css') return { __esModule:true, default: {glass:'glass'} };
 if(cache[name]) return cache[name];
 if(!source[name]) return { __esModule:true, default: () => null };
 const exports = {}; cache[name] = exports; new Function('require','exports',source[name])(require,exports); return exports;
}
const h = React.createElement;
const Play = require('play').Positions;
const Real = require('real').RealPositionCard;
const Toolbar = require('toolbar').default;
window.navigation = [];
window.actions = [];
const p = {market_address:'fixture-market',market_title:'Arsenal vs Leeds United',outcome_index:0,outcome_name:'Arsenal',status:'open',total_stake_usd:'1400.00',total_shares:'100',trade_count:1,estimated_payout_usd:'7300.00',realized_pnl_usd:null,last_trade_at:'2026-10-08T10:00:00Z'};
const r = {marketAddress:'fixture-real',title:p.market_title,outcomeIndex:0,outcomeName:'Arsenal',shares:100,payoutLamports:1840000000,marketNetStakeLamports:1400000000,heldOutcomeCount:1,lastTradeAt:p.last_trade_at};
const section = (id, child) => h('div', {id,style:{marginBottom:16}}, child);
function App(){return h('main',{style:{padding:16,background:'#000',minHeight:'100vh',color:'#fff',fontFamily:'Arial'}},
 section('play',h(Play,{positions:[p],pending:false,onOpenPosition:p=>window.navigation.push('/trade/'+p.market_address),onShare:()=>window.actions.push('share')})),
 section('real',h(Real,{position:r,usd:150})),
 section('multi-real',h(Real,{position:{...r,heldOutcomeCount:2,outcomeName:'Leeds',outcomeIndex:1},usd:null})),
 section('one',h(Toolbar,{label:p.market_title,payout:'$7,300',active:null,onOpen:a=>window.actions.push(a)})),
 section('real-toolbar',h(Toolbar,{label:p.market_title,payout:'1.84 SOL',active:null,onOpen:a=>window.actions.push(a)})),
 section('multiple',h(Toolbar,{label:p.market_title,payout:null,active:null,onOpen:a=>window.actions.push(a)})),
 section('zero',h(Toolbar,{label:p.market_title,payout:null,active:null,onOpen:a=>window.actions.push(a)}))
)}
ReactDOM.createRoot(document.getElementById('root')).render(h(App));
`;
fs.writeFileSync(path.join(output, 'fixture.html'), `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fs.readFileSync(path.join(output, 'style.css'))}\n${glass}</style></head><body><div id="root"></div><script>${react}</script><script>${dom}</script><script>${script.replace(/<\/script/gi,'<\\/script')}</script></body></html>`);
(async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {})});
  try {
    for(const [width,height] of [[390,844],[430,932]]) {
      const page = await browser.newPage({viewport:{width,height},locale:'en-US'});
      const errors = []; page.on('pageerror', e=>{errors.push(e.message); console.error(e.message);});
      await page.goto('file://' + path.join(output,'fixture.html'));
      await page.locator('#real a').waitFor();
      assert.deepEqual(errors,[]);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      const mobile = page.locator('#play .md\\:hidden');
      assert.match(await mobile.innerText(),/Est\. payout if resolved now\n\$7,300\.00/);
      assert.match(await mobile.innerText(),/\$1,400\.00 staked/);
      assert.match(await page.locator('#real').innerText(),/1\.4 SOL net staked/);
      assert.match(await page.locator('#real').innerText(),/\$210\.00/);
      assert.equal(await page.locator('#real a').getAttribute('href'),'/trade/fixture-real');
      assert.match(await page.locator('#multiple').innerText(),/Arsenal vs Leeds United/);
      assert.match(await page.locator('#zero').innerText(),/Arsenal vs Leeds United/);
      for (const selector of ['#one span[title]', '#real-toolbar span[title]']) {
        const metrics = await page.locator(selector).evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,height:el.getBoundingClientRect().height,color:getComputedStyle(el.querySelector('.text-pump-green')).color}));
        assert.ok(metrics.scroll <= metrics.width); assert.ok(metrics.height <= 29); assert.equal(metrics.color,'rgb(0, 255, 136)');
      }
      await mobile.locator('[role=link]').click();
      assert.deepEqual(await page.evaluate(()=>window.navigation),['/trade/fixture-market']);
      await mobile.locator('[role=link]').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>window.navigation.length),2);
      // Future/internal action isolation: bubble click and Enter through the real card handler.
      await mobile.locator('[role=link]').evaluate(el=>{const b=document.createElement('button');b.textContent='Internal action';el.append(b);});
      await page.getByRole('button',{name:'Internal action'}).click();
      await page.getByRole('button',{name:'Internal action'}).focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(()=>window.navigation.length),2);
      await page.getByRole('button',{name:'Internal action'}).evaluate(el=>el.remove());
      await page.locator('#one').getByRole('button',{name:'Discussion',exact:true}).click();
      await page.locator('#one').getByRole('button',{name:'Activity',exact:true}).click();
      await page.locator('#one').getByRole('button',{name:'More market information'}).click();
      await page.locator('#one').getByRole('button',{name:'rules',exact:true}).click();
      assert.deepEqual(await page.evaluate(()=>window.actions),['discussion','activity','rules']);
      await page.screenshot({path:path.join(output, width+'x'+height+'.png'),fullPage:true});
      console.log('PASS: '+width+'×'+height+' overflow, payout labels/colors, SOL/USD stake, title fallback, navigation, action isolation, toolbar actions');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
