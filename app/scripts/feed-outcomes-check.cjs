#!/usr/bin/env node
// Read-only regression checks against the actual feed presentation helper.
// Run from any directory: node app/scripts/feed-outcomes-check.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.resolve(__dirname, "../src/lib/feedOutcomes.ts");
const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  fileName: filename,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const moduleExports = {};
vm.runInNewContext(compiled.outputText, { exports: moduleExports }, { filename });
const { footballMatchOutcomeIndices } = moduleExports;
assert.equal(typeof footballMatchOutcomeIndices, "function");

const fixture = {
  isSoccer: true,
  marketMode: "sport",
  sportMeta: { home_team: "Manchester United", away_team: "Tottenham Hotspur" },
  outcomeNames: ["Manchester United", "Draw", "Tottenham Hotspur"],
};
const detect = (overrides = {}) => {
  const result = footballMatchOutcomeIndices({ ...fixture, ...overrides });
  return result === null ? null : Array.from(result);
};

let passed = 0;
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  passed += 1;
};

check("official soccer keeps the three canonical outcome indices", detect(), [0, 1, 2]);
check("display reordering preserves original trade indices", detect({
  outcomeNames: ["Draw", "Tottenham Hotspur", "Manchester United"],
}), [2, 0, 1]);
check("case and surrounding whitespace do not change fixture identity", detect({
  outcomeNames: [" MANCHESTER UNITED ", " draw ", "tottenham hotspur"],
}), [0, 1, 2]);
check("long club names remain complete when matching metadata", detect({
  sportMeta: {
    home_team: "Club Atlético de Madrid Fútbol Club",
    away_team: "Brighton & Hove Albion Football Club",
  },
  outcomeNames: [
    "Brighton & Hove Albion Football Club", "Draw", "Club Atlético de Madrid Fútbol Club",
  ],
}), [2, 1, 0]);
check("non-soccer markets preserve generic behavior", detect({ isSoccer: false }), null);
check("soccer side markets preserve generic behavior", detect({ marketMode: "sport_side" }), null);
check("side-market metadata also excludes special layout", detect({
  sportMeta: { ...fixture.sportMeta, side_market: true },
}), null);
check("missing match mode does not guess from outcome names", detect({ marketMode: undefined }), null);
check("generic markets do not become match winners", detect({ marketMode: "classic" }), null);
check("binary matches retain their existing behavior", detect({
  outcomeNames: ["Manchester United", "Tottenham Hotspur"],
}), null);
check("four-way markets retain their existing behavior", detect({
  outcomeNames: [...fixture.outcomeNames, "Cancelled"],
}), null);
check("three-way prop outcomes do not become match winners", detect({
  outcomeNames: ["Over", "Exactly", "Under"],
}), null);
check("missing outcomes do not produce a special layout", detect({ outcomeNames: undefined }), null);
check("missing fixture metadata does not produce a special layout", detect({ sportMeta: null }), null);
check("missing away team is insufficient fixture metadata", detect({
  sportMeta: { home_team: "Manchester United" },
}), null);
check("duplicate team metadata cannot produce duplicate trade indices", detect({
  sportMeta: { home_team: "Manchester United", away_team: "Manchester United" },
}), null);
check("duplicate outcome labels cannot hide a missing team", detect({
  outcomeNames: ["Manchester United", "Draw", "Manchester United"],
}), null);
check("a Draw label alone does not establish a match winner", detect({
  outcomeNames: ["Candidate A", "Draw", "Candidate B"],
}), null);

console.log(`PASS: ${passed} feed football outcome checks; no services or trading state touched.`);
