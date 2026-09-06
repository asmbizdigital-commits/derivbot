import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const predictionSource = readFileSync(new URL("../lib/match-prediction.ts", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const importerSource = pageSource.slice(pageSource.indexOf("const defaultImportedMatchStrategy:"), pageSource.indexOf("const eaStrategyPresets:"));
const context = vm.createContext({});
const source = predictionSource.replaceAll("export ", "") + "\n" + importerSource + `
globalThis.api = { buildMatchPrediction, parseAdvancedMatchStrategyMarkdown };
`;
vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
const { buildMatchPrediction, parseAdvancedMatchStrategyMarkdown } = context.api;
const markdown = readFileSync(new URL("../strategies/matches-most-appearing-first-second.md", import.meta.url), "utf8");
const profile = parseAdvancedMatchStrategyMarkdown(markdown);
const prices = (digits) => digits.map((digit) => 100 + digit / 1000);
const digits = [...Array(20).fill(7), ...Array(15).fill(3), ...Array(10).fill(9), ...Array(5).fill(0)];
const predict = (sequence, completed = 0, preferred = null, rules = profile.rules) => buildMatchPrediction(prices(sequence), 3, preferred, rules, completed);

test("import preserves top-two mode and restricts batches to one contract", () => {
  assert.equal(profile.rules.selectionMode, "top_two_frequency");
  assert.equal(profile.stake, 0.5);
  assert.equal(profile.stopLoss, -4);
  assert.equal(profile.maxRecoverySteps, 0);
  assert.equal(profile.bypassPayoutFilter, true);
  const altered = markdown.replace('"contractsPerSignal": 1', '"contractsPerSignal": 8');
  assert.equal(parseAdvancedMatchStrategyMarkdown(altered).contractsPerSignal, 1);
});

test("waits for full window, then alternates rank after confirmed contracts", () => {
  assert.equal(predict(digits.slice(1)).bestCandidate, null);
  for (const [count, digit] of [[0, 7], [1, 3], [2, 7], [3, 3]]) {
    const result = predict(digits, count);
    assert.equal(result.bestCandidate.digit, digit);
    assert.equal(result.candidates.filter((candidate) => candidate.stable).length, 1);
  }
  assert.equal(predict(digits, 1).bestCandidate.probability, 0.3);
  assert.equal(predict(digits, 1).bestCandidate.digit, predict(digits, 1).bestCandidate.digit);
});

test("uses rolling ranking and breaks ties by digit, preserving terminal zeros", () => {
  const equal = Array.from({ length: 50 }, (_, index) => index % 10);
  assert.equal(predict(equal).bestCandidate.digit, 0);
  assert.equal(predict(equal, 1).bestCandidate.digit, 1);
  const changed = [...digits, ...Array(30).fill(4), ...Array(20).fill(2)];
  assert.equal(predict(changed).bestCandidate.digit, 4);
  assert.equal(predict(changed, 1).bestCandidate.digit, 2);
});

test("fixed digit override and existing frequency mode retain their behavior", () => {
  assert.equal(predict(digits, 1, 9).bestCandidate.digit, 9);
  const rules = { ...profile.rules, selectionMode: "frequency_window" };
  assert.equal(predict(digits, 1, null, rules).bestCandidate.digit, 7);
});
