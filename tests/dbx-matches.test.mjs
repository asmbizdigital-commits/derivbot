import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../app/page.tsx");
const config = read("../lib/dbx-matches.ts").replaceAll("export ", "");
const prediction = read("../lib/match-prediction.ts").replaceAll("export ", "");
const importer = page.slice(page.indexOf("const defaultImportedMatchStrategy:"), page.indexOf("const eaStrategyPresets:"));
const runner = page.slice(page.indexOf("  function maybeRunDerivAuto("), page.indexOf("  function requestDerivOverUnderQuoteScan("));
const selection = page.slice(page.indexOf("  function selectMatchStrategy("), page.indexOf("  async function importMatchStrategyFile("));
const helpers = vm.createContext({});
vm.runInContext(ts.transpileModule(config + prediction + importer + "\nglobalThis.api = { DBX_MATCH_CONFIG, DBX_DYNAMIC_MATCH_CONFIG, DBX_LAST_DIGIT_CONFIG, DBX_V3_GUARD, dbxV3BudgetAllows, evaluateDbxV3Quote, isDbxMode, buildMatchPrediction, buildDbxMatchOrder, validDbxQuote, parseAdvancedMatchStrategyMarkdown, dbxMatchStrategy, dbxDynamicMatchStrategy, dbxLastDigitStrategy };", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, helpers);
const { DBX_MATCH_CONFIG, DBX_DYNAMIC_MATCH_CONFIG, DBX_LAST_DIGIT_CONFIG, DBX_V3_GUARD, dbxV3BudgetAllows, evaluateDbxV3Quote, isDbxMode, buildMatchPrediction, buildDbxMatchOrder, validDbxQuote, parseAdvancedMatchStrategyMarkdown, dbxMatchStrategy, dbxDynamicMatchStrategy, dbxLastDigitStrategy } = helpers.api;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("importable DBX profile reflects fixed XML trade options without a statistical entry", () => {
  const profile = parseAdvancedMatchStrategyMarkdown(read("../strategies/matches-dbx-v2-pro.md"));
  assert.equal(profile.executionMode, "dbx_fixed");
  assert.equal(profile.fixedDigit, 1); assert.equal(profile.barrierMode, "fixed");
  assert.equal(profile.stake, 5); assert.equal(profile.contractsPerSignal, 1);
  assert.equal(profile.bypassPayoutFilter, true);
  assert.equal(profile.maxRecoverySteps, 0);
  assert.equal(profile.takeProfit, null); assert.equal(profile.stopLoss, null);
  assert.deepEqual(plain(buildDbxMatchOrder(5)), { contractType: "DIGITMATCH", symbol: "1HZ50V", barrier: 1, duration: 1, stake: 5, batchIndex: 1, batchTotal: 1, dbx: true });
});

test("fixed stake remains configurable; invalid stakes and quotes cannot buy", () => {
  assert.equal(buildDbxMatchOrder(7.5).stake, 7.5);
  for (const stake of [NaN, Infinity, 0, -1, 0.34]) assert.equal(buildDbxMatchOrder(stake), null);
  assert.equal(validDbxQuote(5, 48, 5, 100), true);
  for (const values of [[6,48,5,100], [5,NaN,5,100], [0,48,5,100], [5,5,5,100], [5,48,5,4], [5,48,5,null]]) assert.equal(validDbxQuote(...values), false);
});

function harness(dynamic = false) {
  const lastMode = dynamic === "last";
  const refs = {
    derivModeRef: "auto", derivAutoRunningRef: true, derivStatusRef: "demo",
    derivOpenContractsRef: new Set(), derivAutoQuoteRef: new Map(), derivPendingBuysRef: new Map(), derivOverUnderQuoteScanRef: null,
    derivMaxSignalsRef: 200, derivSessionSignalsRef: 0, derivContractTypeRef: "DIGITMATCH",
    derivPipSizeRef: 3, derivMatchStrategyRef: lastMode ? dbxLastDigitStrategy : dynamic ? dbxDynamicMatchStrategy : dbxMatchStrategy, derivSessionPnlRef: 0, derivMarketRef: "1HZ50V",
    derivPortfolioReadyRef: true, derivStakeRef: 5, derivBalanceRef: 100, derivCurrencyRef: "USD",
    derivAutoDigitBarrierModeRef: "dynamic", derivMatchPositionCountRef: 5, derivDigitBarrierRef: 7,
    derivMartingaleEnabledRef: true, derivDoubleRiskEnabledRef: true, derivHalfBalanceRiskEnabledRef: true,
  };
  const state = Object.fromEntries(Object.entries(refs).map(([key, current]) => [key, { current }]));
  const orders = [], statuses = [], selected = [];
  const context = vm.createContext({ ...state, DBX_MATCH_CONFIG, DBX_DYNAMIC_MATCH_CONFIG, DBX_LAST_DIGIT_CONFIG, DBX_V3_GUARD, dbxV3BudgetAllows, evaluateDbxV3Quote, isDbxMode, buildMatchPrediction, dbxMatchStrategy, dbxDynamicMatchStrategy, dbxLastDigitStrategy, defaultImportedMatchStrategy: {}, importedMatchProfile: null, buildDbxMatchOrder,
    isDerivTradingStatus: (status) => status === "demo", pairBalanceAllows: (cost, balance) => balance >= cost,
    setDerivAutoStatus: (text) => statuses.push(text),
    stopDerivAutoOnSignalLimit: () => { state.derivAutoRunningRef.current = false; },
    stopDerivAutoOnPnlLimit: () => { state.derivAutoRunningRef.current = false; },
    registerDerivSessionSignal: () => state.derivSessionSignalsRef.current++,
    requestDerivAutoPosition: (_, order) => { orders.push(plain(order)); state.derivAutoQuoteRef.current.set(1, order); },
    stopDerivAuto: () => { state.derivAutoRunningRef.current = false; },
    changeDerivMarket: (market) => { state.derivMarketRef.current = market; },
    ...Object.fromEntries(["setMatchStrategy", "setMatchStrategySelection", "setDerivMode", "setDerivContractCategory", "setDerivContractType", "setDerivAutoDigitBarrierMode", "setDerivMatchPositionCount", "setDerivDigitBarrier", "setDerivStake", "setDerivMartingaleEnabled", "setDerivDoubleRiskEnabled", "setDerivHalfBalanceRiskEnabled", "setMatchPredictionOpen", "setMatchStrategyImportStatus"].map((name) => [name, (value) => selected.push([name, value])])),
  });
  vm.runInContext(ts.transpileModule(runner + selection + "\nglobalThis.run = maybeRunDerivAuto; globalThis.select = selectMatchStrategy;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { state, orders, statuses, selected, run: (ticks = [100.007]) => context.run(ticks, {}), select: () => context.select(lastMode ? "dbx_last_digit" : dynamic ? "dbx_dynamic" : "dbx") };
}

test("DBX execution skips statistical filters and ignores risk multipliers after losses", () => {
  const h = harness();
  h.run([100.007]); // Digit 1 has not appeared: still a fixed prediction.
  assert.equal(h.orders.length, 1);
  assert.equal(h.orders[0].barrier, 1); assert.equal(h.orders[0].stake, 5);
  h.run(); assert.equal(h.orders.length, 1, "pending quote blocks another order");
  h.state.derivAutoQuoteRef.current.clear();
  h.state.derivPendingBuysRef.current.set(1, h.orders[0]);
  h.run(); assert.equal(h.orders.length, 1, "pending buy blocks another order");
  h.state.derivPendingBuysRef.current.clear(); h.state.derivOpenContractsRef.current.add(123);
  h.run(); assert.equal(h.orders.length, 1, "open contract blocks another order");
  h.state.derivOpenContractsRef.current.clear(); h.state.derivSessionPnlRef.current = -5;
  h.run([100.009]);
  assert.equal(h.orders.length, 2);
  assert.deepEqual(h.orders[1], h.orders[0], "a loss changes neither digit, duration, market nor stake");
});

test("DBX honours Stop, session limit, account readiness, market and available funds", () => {
  for (const [key, value] of [["derivAutoRunningRef", false], ["derivPortfolioReadyRef", false], ["derivSessionSignalsRef", 200], ["derivMarketRef", "R_25"], ["derivBalanceRef", 4]]) {
    const h = harness(); h.state[key].current = value; h.run(); assert.equal(h.orders.length, 0, key);
  }
  const h = harness(); h.run([]); h.run([NaN]); assert.equal(h.orders.length, 0);
});

test("selecting the preset configures DBX but never starts trading", () => {
  const h = harness(); h.state.derivAutoRunningRef.current = false; h.state.derivMarketRef.current = "R_25";
  h.select();
  assert.equal(h.state.derivMarketRef.current, "1HZ50V");
  assert.equal(h.state.derivDigitBarrierRef.current, 1);
  assert.equal(h.state.derivStakeRef.current, 5);
  assert.equal(h.state.derivMatchPositionCountRef.current, 1);
  assert.equal(h.state.derivMartingaleEnabledRef.current, false);
  assert.equal(h.state.derivAutoRunningRef.current, false);
  assert.equal(h.orders.length, 0);
  assert.ok(h.selected.some(([name, value]) => name === "setMatchStrategySelection" && value === "dbx"));
});

test("strategy selector exposes DBX and its fixed stake can be edited before Play", async () => {
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const ast = ts.createSourceFile("page.tsx", page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = [];
  function visit(node) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const selector = nodes.find((node) => ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "select" && node.openingElement.getText(ast).includes('aria-label="Stratégie Matches"'));
  const stake = nodes.find((node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input" && node.getText(ast).includes("value={derivStake}") && node.getText(ast).includes("derivDoubleRiskSeriesIndexRef"));
  assert.ok(selector); assert.ok(stake);
  const selected = [];
  const context = vm.createContext({ React, DBX_MATCH_CONFIG, DBX_DYNAMIC_MATCH_CONFIG, DBX_LAST_DIGIT_CONFIG, matchStrategySelection: "dbx", derivAutoRunning: false,
    importedMatchProfile: null, selectMatchStrategy: (value) => selected.push(value),
    isDbxMatch: true, derivHalfBalanceRiskEnabled: false, derivStake: 5 });
  vm.runInContext(ts.transpileModule(`globalThis.selector = (${selector.getText(ast)}); globalThis.stake = (${stake.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, context);
  assert.match(renderToStaticMarkup(context.selector), /DBX \(V2\) Pro/);
  assert.match(renderToStaticMarkup(context.selector), /DBX \(V3\.1\) Adaptatif/);
  assert.match(renderToStaticMarkup(context.selector), /DBX \(V4\) Last Digit/);
  context.selector.props.onChange({ target: { value: "dbx" } });
  assert.deepEqual(selected, ["dbx"]);
  assert.equal(context.stake.props.disabled, false);
  assert.equal(context.stake.props.value, 5);
});

const prices = (digits) => digits.map((digit) => 100 + digit / 1000);
const mostly = (digit, second = 2) => prices(Array.from({ length: 200 }, (_, i) => i % 5 === 0 ? second : digit));

test("V3 imports as a separately named dynamic profile while V2 remains fixed", () => {
  const dynamic = parseAdvancedMatchStrategyMarkdown(read("../strategies/matches-dbx-v3-adaptatif.md"));
  assert.equal(dynamic.executionMode, "dbx_dynamic");
  assert.equal(dynamic.name, DBX_DYNAMIC_MATCH_CONFIG.name);
  assert.notEqual(dynamic.name, dbxMatchStrategy.name);
  assert.equal(dynamic.fixedDigit, null); assert.equal(dynamic.barrierMode, "dynamic");
  assert.equal(dynamic.rules.selectionMode, "top_two_adaptive");
  assert.equal(dynamic.rules.minimumTicks, 50); assert.equal(dynamic.rules.windowSize, 50);
  assert.equal(dynamic.stake, 5); assert.equal(dynamic.contractsPerSignal, 1);
  assert.equal(dynamic.bypassPayoutFilter, false); assert.equal(dynamic.lossBudgetStakes, 4);
  const modified = read("../strategies/matches-dbx-v3-adaptatif.md").replace('"stake": 5', '"stake": 3.5').replace('"fixedDigit": null', '"fixedDigit": 1');
  const custom = parseAdvancedMatchStrategyMarkdown(modified);
  assert.equal(custom.stake, 3.5); assert.equal(custom.fixedDigit, null);
  assert.equal(dbxMatchStrategy.fixedDigit, 1); assert.equal(dbxMatchStrategy.executionMode, "dbx_fixed");
});

test("V3.1 selects a dynamic digit after 200 evidence ticks and updates it for the next contract", () => {
  const h = harness(true);
  h.run(mostly(7).slice(1)); assert.equal(h.orders.length, 0);
  h.state.derivDigitBarrierRef.current = 1; // An old fixed choice must not override V3.
  h.run(mostly(7)); assert.equal(h.orders.length, 1);
  assert.equal(h.orders[0].barrier, 7);
  assert.equal(h.orders[0].symbol, "1HZ50V"); assert.equal(h.orders[0].duration, 1);
  assert.equal(h.orders[0].stake, 5); assert.equal(h.orders[0].batchTotal, 1);
  h.run(mostly(3));
  assert.equal(h.orders.length, 1); assert.equal(h.orders[0].barrier, 7, "in-flight quote retains its digit");
  h.state.derivAutoQuoteRef.current.clear();
  h.state.derivOpenContractsRef.current.add(123);
  h.run(mostly(3)); assert.equal(h.orders.length, 1);
  h.state.derivOpenContractsRef.current.clear(); h.state.derivSessionPnlRef.current = -5;
  h.run(mostly(3)); assert.equal(h.orders.length, 2);
  assert.equal(h.orders[1].barrier, 3); assert.equal(h.orders[1].stake, 5);
});

test("V3 handles every digit including zero, rejects invalid data and does not force rotation", () => {
  for (let digit = 0; digit < 10; digit++) {
    const h = harness(true); h.run(mostly(digit, (digit + 1) % 10));
    assert.equal(h.orders[0].barrier, digit);
    h.state.derivAutoQuoteRef.current.clear(); h.state.derivSessionPnlRef.current = -5;
    h.run(mostly(digit, (digit + 1) % 10)); assert.equal(h.orders[1].barrier, digit);
  }
  for (const data of [[], [...mostly(7).slice(1), NaN], [Infinity, ...mostly(7)]]) {
    const h = harness(true); h.run(data); assert.equal(h.orders.length, 0);
  }
  for (const digit of [-1, 10, 1.5, NaN]) assert.equal(buildDbxMatchOrder(5, digit), null);
});

test("V3 selection prepares dynamic settings without starting or enabling multipliers", () => {
  const h = harness(true); h.state.derivAutoRunningRef.current = false; h.select();
  assert.equal(h.state.derivMatchStrategyRef.current.executionMode, "dbx_dynamic");
  assert.equal(h.state.derivAutoDigitBarrierModeRef.current, "dynamic");
  assert.equal(h.state.derivMartingaleEnabledRef.current, false);
  assert.equal(h.state.derivAutoRunningRef.current, false);
  assert.ok(h.selected.some(([name, value]) => name === "setMatchStrategySelection" && value === "dbx_dynamic"));
  assert.equal(h.orders.length, 0);
});

const lastWindow = (last) => prices([...Array(30).fill(7), ...Array(19).fill(3), last]);

test("V4 import and selection preserve separate names and require last-digit Top 2", () => {
  const profile = parseAdvancedMatchStrategyMarkdown(read("../strategies/matches-dbx-v4-last-digit-most-appearing.md"));
  assert.equal(profile.name, DBX_LAST_DIGIT_CONFIG.name);
  assert.equal(profile.executionMode, "dbx_last_digit");
  assert.equal(profile.rules.selectionMode, "last_digit_top_two");
  assert.equal(profile.fixedDigit, null); assert.equal(profile.rules.minimumTicks, 50);
  const h = harness("last"); h.state.derivAutoRunningRef.current = false; h.select();
  assert.equal(h.state.derivMatchStrategyRef.current.executionMode, "dbx_last_digit");
  assert.equal(h.orders.length, 0);
  assert.ok(h.selected.some(([name, value]) => name === "setMatchStrategySelection" && value === "dbx_last_digit"));
});

test("V4 waits outside Top 2 and matches the last digit, including second rank", () => {
  const h = harness("last");
  h.run(lastWindow(3).slice(1)); assert.equal(h.orders.length, 0);
  h.run(lastWindow(9)); assert.equal(h.orders.length, 0);
  assert.match(h.statuses.at(-1), /dernier digit 9.*7 \/ 3/);
  h.run(lastWindow(3)); assert.equal(h.orders[0].barrier, 3);
  assert.equal(h.orders[0].dbxLastDigit, true);
  h.run(lastWindow(7)); assert.equal(h.orders.length, 1, "no overlap during quotes");
  h.state.derivAutoQuoteRef.current.clear(); h.run(lastWindow(7));
  assert.equal(h.orders[1].barrier, 7); assert.equal(h.orders[1].stake, 5);
});

test("V4 uses a rolling window, deterministic ties and terminal zeros", () => {
  const rules = dbxLastDigitStrategy.rules;
  const ties = prices([...Array(10).fill(7), ...Array(10).fill(3), ...Array(10).fill(1), ...Array(19).fill(2), 1]);
  const selected = buildMatchPrediction(ties, 3, 7, rules);
  assert.equal(selected.bestCandidate.digit, 1, "last digit rule overrides a fixed preference");
  const tiedUniform = prices([...Array.from({ length: 49 }, (_, i) => i % 10), 9]);
  assert.equal(buildMatchPrediction(tiedUniform, 3, null, rules).bestCandidate, null, "tie chooses digits 0 and 1");
  const zeros = prices([...Array(30).fill(7), ...Array(19).fill(0), 0]);
  assert.equal(buildMatchPrediction(zeros, 3, null, rules).bestCandidate.digit, 0);
  assert.equal(buildMatchPrediction([...prices(Array(100).fill(9)), ...zeros], 3, null, rules).bestCandidate.digit, 0);
  assert.equal(buildMatchPrediction([NaN, ...zeros.slice(1)], 3, null, rules).bestCandidate, null);
});

test("V4 quote acceptance rechecks the current last digit and its Top 2 membership", () => {
  const begin = page.indexOf("            if (autoQuote.dbxLastDigit)");
  const end = page.indexOf("            if (autoQuote.dbx &&", begin);
  assert.ok(begin > 0 && end > begin);
  for (const [ticks, market, accepted] of [[lastWindow(3), "1HZ50V", true], [lastWindow(9), "1HZ50V", false], [prices([...Array(25).fill(7), ...Array(24).fill(2), 3]), "1HZ50V", false], [lastWindow(7), "1HZ50V", false], [lastWindow(3), "R_25", false], [prices([...Array(49).fill(7), 3]), "1HZ50V", true], [[], "1HZ50V", false]]) {
    const context = vm.createContext({ autoQuote: { dbxLastDigit: true, barrier: 3, symbol: "1HZ50V" }, buildMatchPrediction,
      derivTicksRef: { current: ticks }, derivPipSizeRef: { current: 3 }, derivMatchStrategyRef: { current: dbxLastDigitStrategy },
      derivMarketRef: { current: market }, setDerivAutoStatus() {} });
    vm.runInContext(`function check() { ${page.slice(begin, end)} return true; } globalThis.accepted = check() === true;`, context);
    assert.equal(context.accepted, accepted);
  }
});

test("V3.1 refuses insufficient evidence, negative EV and weak historical support", () => {
  const uniform = prices(Array.from({ length: 200 }, (_, i) => i % 10));
  const weak = evaluateDbxV3Quote({ digit: 1, probability: 0.105 }, uniform, 3, 5, 44.64);
  assert.equal(weak.accepted, false);
  assert.ok(Math.abs(weak.breakEven - 5 / 44.64) < 1e-12);
  assert.ok(weak.expectedValue < 0);
  assert.ok(weak.lowerFrequency < 0.1);
  assert.equal(evaluateDbxV3Quote({ digit: 1, probability: 0.9 }, uniform, 3, 5, 44.64).accepted, false, "model overconfidence cannot replace evidence");
  assert.equal(evaluateDbxV3Quote({ digit: 7, probability: 0.9 }, mostly(7).slice(1), 3, 5, 44.64).accepted, false);
  assert.equal(evaluateDbxV3Quote({ digit: 7, probability: 0.1 }, mostly(7), 3, 5, 44.64).accepted, false, "historical clustering cannot replace model evidence");
  const strong = evaluateDbxV3Quote({ digit: 7, probability: 0.3 }, mostly(7), 3, 5, 44.64);
  assert.equal(strong.accepted, true);
  assert.equal(strong.conservativeProbability, 0.3);
  assert.ok(strong.conservativeExpectedValue >= 0.1);
  for (const [ask, payout] of [[0,44.64],[5,NaN],[5,5],[5,Infinity]]) assert.equal(evaluateDbxV3Quote({ digit: 7, probability: 0.3 }, mostly(7), 3, ask, payout).accepted, false);
  assert.equal(evaluateDbxV3Quote({ digit: 7, probability: 0.3 }, [NaN,...mostly(7).slice(1)], 3, 5, 44.64).accepted, false);
});

test("V3.1 reserves the next stake within the editable net loss budget", () => {
  assert.equal(dbxV3BudgetAllows(-15, 5, 4), true);
  assert.equal(dbxV3BudgetAllows(-15.01, 5, 4), false);
  assert.equal(dbxV3BudgetAllows(-20, 5, 4), false);
  assert.equal(dbxV3BudgetAllows(-20, 5, 6), true);
  assert.equal(dbxV3BudgetAllows(NaN, 5, 4), false);
  const h = harness(true); h.state.derivSessionPnlRef.current = -20; h.run(mostly(7));
  assert.equal(h.orders.length, 0); assert.equal(h.state.derivAutoRunningRef.current, false);
  const valid = harness(true); valid.run(mostly(7));
  assert.equal(valid.state.derivSessionSignalsRef.current, 0, "quote attempts do not exhaust the purchase limit");
  assert.ok(valid.orders[0].matchCandidate);
  assert.equal(typeof valid.orders[0].dbxGuardRequestedAt, "number");
  const doc = read("../strategies/matches-dbx-v3-adaptatif.md");
  assert.equal(parseAdvancedMatchStrategyMarkdown(doc.replace('"lossBudgetStakes": 4', '"lossBudgetStakes": 6')).lossBudgetStakes, 6);
  assert.equal(dbxLastDigitStrategy.lossBudgetStakes, null, "V4 is unchanged");
  assert.equal(dbxLastDigitStrategy.bypassPayoutFilter, true);
});

test("V3.1 buy gate rejects expired quotes, changed digits and depleted budget", () => {
  const begin = page.indexOf("            if (autoQuote.dbxGuardRequestedAt !== undefined)");
  const end = page.indexOf("            if (autoQuote.dbxLastDigit)", begin);
  assert.ok(begin > 0 && end > begin);
  for (const reason of ["valid", "expired", "digit", "payout", "budget", "strategy", "future", "market"]) {
    const now = 1800000000000;
    const ticks = mostly(reason === "digit" ? 3 : 7);
    const context = vm.createContext({ Date: { now: () => now },
      autoQuote: { dbxGuardRequestedAt: now - (reason === "expired" ? 3001 : reason === "future" ? -1 : 100), symbol: "1HZ50V", barrier: 7, matchCandidate: { digit: 7, probability: 0.3 } },
      proposal: { ask_price: 5, payout: reason === "payout" ? 6 : 44.64 },
      derivMatchStrategyRef: { current: reason === "strategy" ? dbxLastDigitStrategy : dbxDynamicMatchStrategy },
      derivTicksRef: { current: ticks }, derivPipSizeRef: { current: 3 }, derivMarketRef: { current: reason === "market" ? "R_25" : "1HZ50V" },
      derivSessionPnlRef: { current: reason === "budget" ? -20 : 0 }, derivStakeRef: { current: 5 },
      buildMatchPrediction, DBX_V3_GUARD, dbxV3BudgetAllows, evaluateDbxV3Quote, setDerivAutoStatus() {}, stopDerivAutoOnPnlLimit() {} });
    vm.runInContext(`function check() { ${page.slice(begin,end)} return true; } globalThis.accepted = check() === true;`, context);
    assert.equal(context.accepted, reason === "valid", reason);
  }
});

test("V3.1 stops on an unknown settlement profit instead of treating it as zero", () => {
  const begin = page.indexOf("        if (isSold && profit === null");
  const end = page.indexOf("        const ticksElapsed", begin);
  assert.ok(begin > 0 && end > begin);
  const halted = [];
  const context = vm.createContext({ isSold: true, profit: null, openContract: { contract_id: 123 },
    derivMatchContractIdsRef: { current: new Set([123]) }, derivMatchStrategyRef: { current: dbxDynamicMatchStrategy },
    stopDerivAutoOnPnlLimit: (message) => halted.push(message) });
  vm.runInContext(`function check() { ${page.slice(begin,end)} return true; } globalThis.continued = check() === true;`, context);
  assert.equal(context.continued, false); assert.equal(halted.length, 1);
  assert.match(halted[0], /résultat net manquant/);
});
