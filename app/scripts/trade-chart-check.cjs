#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/components/trade/chartGeometry.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
const exportsObject = {};
vm.runInNewContext(compiled.outputText, { exports: exportsObject });
const { currentValues, probabilityDomain, separateLabels } = exportsObject;
let checks = 0;
for (const values of [[50,50],[51,49],[34,33,33],[35,34,31],[90,10],[99,1],[100,0],[31,32,34,33,35]]) {
 const original = JSON.stringify(values);
 const [low, high] = probabilityDomain(values);
 assert(low >= 0 && high <= 100 && high-low >= 20);
 assert(values.every(value => value >= low && value <= high));
 const ys = values.map(value => 218 - (value-low)/(high-low)*198);
 const labels = Array.from(separateLabels(ys, 24, 214)).sort((a,b)=>a-b);
 assert(labels[0] >= 24 && labels.at(-1) <= 214);
 for (let i=1;i<labels.length;i++) assert(labels[i]-labels[i-1] >= Math.min(42,190/(values.length-1))-1e-8);
 assert.equal(JSON.stringify(values),original);
 checks++;
}
assert.deepEqual(Array.from(currentValues([],[],2)),[50,50]);
assert.deepEqual(Array.from(currentValues([63,37],[],2)),[63,37]);
assert.deepEqual(Array.from(currentValues([], [{t:10,pct:[63,37]}],2)),[63,37]);
assert.deepEqual(Array.from(currentValues([100,0],[],2)),[100,0]);
assert.deepEqual(Array.from(currentValues([NaN,20],[],2)),[50,50]);
assert.deepEqual(Array.from(currentValues([0,0],[],2)),[50,50]);
assert.equal(currentValues([],[],3)[0],100/3);
checks += 7;
// Verify linear segments pass directly through every real observation.
const { getPath } = require('recharts/lib/shape/Curve');
for (const values of [[50,50,50],[51,49,50],[34,33,33],[90,10,90],[99,1,100,0],[31,32,34,33,35]]) {
 const points = values.map((y,i)=>({x:i*i*40,y}));
 const original = JSON.stringify(points);
 const curve = getPath({type:'linear',points});
 const expected = `M${points[0].x},${points[0].y}` + points.slice(1).map(point=>
  `L${point.x},${point.y}`
 ).join('');
 assert.equal(curve,expected);
 assert.equal(JSON.stringify(points),original);
 checks++;
}
console.log(`${checks} chart cases passed: domains, label collisions, fallback values and direct real-point segments.`);
