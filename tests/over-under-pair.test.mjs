import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/over-under-pair.ts", import.meta.url), "utf8").replaceAll("export ", "");
const context = vm.createContext({ setInterval: () => 1, clearInterval() {} });
vm.runInContext(ts.transpileModule(source + "\nglobalThis.api = { OverUnderPairScanner, analyzePairDigits, volatilitySymbols, supportsPairLeg, selectPairMarkets, evaluatePairQuotes, pairProfitProtection, pairBalanceAllows, EMPTY_PAIR_STATS };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
const { OverUnderPairScanner, analyzePairDigits, volatilitySymbols, supportsPairLeg, selectPairMarkets, evaluatePairQuotes, pairProfitProtection, pairBalanceAllows, EMPTY_PAIR_STATS } = context.api;
const prices = (digits) => digits.map((digit) => 100 + digit / 1000);
const contracts = ["DIGITOVER", "DIGITUNDER"].map((contract_type) => ({ contract_type, min_contract_duration: "1t", max_contract_duration: "10t" }));

function row(symbol, side, frequency) {
  const digits = Array.from({ length: 200 }, (_, i) => ((i * 37) % 100 < Math.round(frequency * 100)) === (side === "under") ? 4 : 5);
  return { ...analyzePairDigits(prices(digits), 3), symbol, name: symbol, fresh: true, status: "Actif" };
}

function harness({ funds = 100, allow = true, available = () => contracts } = {}) {
  let now = 1_800_000_000_000, seq = 0, signals = 0;
  const sent = [], pending = [], halts = [], statuses = [];
  const scanner = new OverUnderPairScanner({
    now: () => now, nextId: () => ++seq, send: (request) => sent.push(request),
    onUpdate() {}, onStatus: (message) => statuses.push(message), onHalt: (message) => halts.push(message),
    canBuy: (cost) => allow && cost <= funds,
    onBuyRequest: (id, leg) => pending.push({ id, leg }), onSignal: () => signals++,
  });
  function initialize() {
    scanner.start();
    scanner.handle({ req_id: sent[0].req_id, active_symbols: ["R_25", "1HZ15V"].map((underlying_symbol) => ({ underlying_symbol, underlying_symbol_name: `Volatility ${underlying_symbol}`, pip_size: 0.001 })) });
    for (let index = 0; index < 2; index++) {
      scanner.pulse();
      scanner.handle({ req_id: sent.at(-1).req_id, contracts_for: { available: available(index) } });
    }
    for (let index = 0; index < 2; index++) {
      scanner.pulse();
      const request = sent.at(-1);
      const digits = Array.from({ length: 200 }, (_, i) => index === 0 ? (i % 5 ? 2 : 7) : (i % 5 ? 7 : 2));
      scanner.handle({ req_id: request.req_id, subscription: { id: `sub${index}` }, pip_size: 3,
        history: { prices: prices(digits), times: digits.map((_, i) => now / 1000 - (199 - i)) } });
    }
  }
  const quotes = () => sent.filter((request) => request.proposal === 1).slice(-2);
  const buys = () => sent.filter((request) => request.buy);
  const replyQuote = (request, payout = 0.95) => scanner.handle({ req_id: request.req_id, proposal: { id: `quote${request.req_id}`, ask_price: 0.5, payout } });
  return { scanner, sent, pending, halts, statuses, initialize, quotes, buys, replyQuote, signalCount: () => signals,
    advance: (ms) => { now += ms; scanner.pulse(); }, setAllowed: (value) => { allow = value; } };
}

test("Under 5 includes 4; Over 4 includes 5; precision retains zero", () => {
  const result = analyzePairDigits(prices(Array.from({ length: 200 }, (_, i) => i % 10)), 3);
  assert.equal(result.over, 0.5); assert.equal(result.under, 0.5);
  assert.equal(analyzePairDigits(prices([4]), 3).under, 1);
  assert.equal(analyzePairDigits(prices([5]), 3).over, 1);
  assert.equal(analyzePairDigits([100.000], 3).under, 1);
  assert.equal(result.eligible, false);
  assert.equal(analyzePairDigits(prices(Array(99).fill(7)), 3).eligible, false);
  assert.equal(analyzePairDigits([Infinity], 3).eligible, false);
  assert.equal(analyzePairDigits(prices([0]), null).sampleSize, 0);
});

test("discovers new volatility indices and excludes suspended/non-volatility symbols", () => {
  const result = volatilitySymbols([
    { underlying_symbol: "1HZ15V", underlying_symbol_name: "Volatility 15 (1s) Index", pip_size: 0.01 },
    { symbol: "R_25", display_name: "Volatility 25 Index", pip: 0.001 },
    { symbol: "R_25", display_name: "Volatility 25 Index" },
    { symbol: "BOOM1000", display_name: "Boom 1000" },
    { symbol: "R_100", is_trading_suspended: 1 },
  ]);
  assert.deepEqual(Array.from(result, (s) => [s.symbol, s.pipSize]), [["1HZ15V", 2], ["R_25", 3]]);
  assert.equal(supportsPairLeg(contracts, "DIGITUNDER"), true);
  assert.equal(supportsPairLeg(contracts.slice(0, 1), "DIGITUNDER"), false);
  assert.equal(supportsPairLeg(contracts.map((c) => ({ ...c, min_contract_duration: "5t" })), "DIGITOVER"), false);
  assert.equal(supportsPairLeg([{ ...contracts[0], last_digit_range: [5] }], "DIGITOVER"), false);
  assert.equal(supportsPairLeg([{ ...contracts[0], last_digit_range: [4] }], "DIGITOVER"), true);
  assert.equal(supportsPairLeg([{ ...contracts[1], last_digit_range: [5] }], "DIGITUNDER"), true);
});

test("ranks independent streams and sends exactly two buys only after both quotes", () => {
  const h = harness(); h.initialize();
  assert.equal(h.scanner.rows()[0].symbol, "1HZ15V");
  h.scanner.requestBestPair(0.5, "USD");
  const [under, over] = h.quotes();
  assert.deepEqual([under.contract_type, under.barrier, over.contract_type, over.barrier], ["DIGITUNDER", 5, "DIGITOVER", 4]);
  assert.notEqual(over.underlying_symbol, under.underlying_symbol);
  assert.equal(under.underlying_symbol, "R_25");
  assert.equal(over.underlying_symbol, "1HZ15V");
  h.replyQuote(under); assert.equal(h.buys().length, 0);
  h.replyQuote(over); assert.equal(h.buys().length, 2);
  h.replyQuote(over); assert.equal(h.buys().length, 2);
  assert.equal(h.signalCount(), 1); assert.equal(h.pending.length, 2);
  assert.deepEqual(h.pending.map((p) => p.leg.barrier), [5, 4]);
  h.scanner.requestBestPair(0.5, "USD"); assert.equal(h.quotes().length, 2);
});

test("a failed quote, Stop, stale data or changed budget cannot send half a pair", () => {
  for (const reason of ["error", "stop", "stale", "budget"]) {
    const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD");
    const [a, b] = h.quotes(); h.replyQuote(a);
    if (reason === "error") h.scanner.handle({ req_id: b.req_id, error: { message: "Unavailable" } });
    if (reason === "stop") h.scanner.stop();
    if (reason === "stale") h.advance(6000);
    if (reason === "budget") h.setAllowed(false);
    h.replyQuote(b); assert.equal(h.buys().length, 0, reason);
  }
});

test("insufficient funds and invalid or negative-EV quotes are rejected", () => {
  const h = harness({ funds: 0.75 }); h.initialize(); h.scanner.requestBestPair(0.5, "USD");
  assert.equal(h.quotes().length, 0);
  const analysis = [row("R_25", "under", 0.8), row("1HZ15V", "over", 0.8)];
  assert.equal(evaluatePairQuotes(analysis, [{ ask: 0.5, payout: 0.6 }, { ask: 0.5, payout: 0.6 }], 0.5).accepted, false);
  assert.equal(evaluatePairQuotes(analysis, [{ ask: 0.6, payout: 2 }, { ask: 0.5, payout: 2 }], 0.5).accepted, false);
});

test("partial buy failure halts without retry, accepted contract remains tracked", () => {
  const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD"); h.quotes().forEach((q) => h.replyQuote(q));
  const [a, b] = h.buys();
  assert.equal(h.scanner.handle({ req_id: a.req_id, buy: { contract_id: 123 } }), false);
  h.scanner.handle({ req_id: b.req_id, error: { message: "InsufficientBalance" } });
  assert.equal(h.halts.length, 1); assert.equal(h.scanner.active, false); assert.equal(h.scanner.busy, true);
  h.scanner.requestBestPair(0.5, "USD"); assert.equal(h.buys().length, 2);
  h.scanner.handle({ proposal_open_contract: { contract_id: 123, is_sold: 1, profit: -0.5 } });
  assert.equal(h.scanner.busy, false);
});

test("Stop retains buy correlation; missing acknowledgement blocks new pairs", () => {
  const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD"); h.quotes().forEach((q) => h.replyQuote(q));
  const [a, b] = h.buys(); h.scanner.stop();
  h.scanner.handle({ req_id: a.req_id, buy: { contract_id: 12 } });
  h.scanner.handle({ proposal_open_contract: { contract_id: 12, status: "won", profit: 0.8 } });
  assert.equal(h.scanner.busy, true);
  h.advance(16000); assert.equal(h.halts.length, 1); assert.equal(h.scanner.uncertain, true);
  h.scanner.handle({ req_id: b.req_id, buy: { contract_id: 13 } });
  assert.equal(h.scanner.busy, true);
  h.scanner.handle({ proposal_open_contract: { contract_id: 13, status: "lost", profit: -0.5 } });
  assert.equal(h.scanner.busy, false);
});

test("stream correlation survives missing echo and duplicate/out-of-order ticks", () => {
  const h = harness(); h.initialize();
  const initial = h.scanner.rows().find((row) => row.symbol === "R_25").sampleSize;
  const epoch = 1_800_000_000;
  h.scanner.handle({ subscription: { id: "sub0" }, tick: { symbol: "R_25", epoch, quote: 100.004, pip_size: 3 } });
  h.scanner.handle({ subscription: { id: "sub0" }, tick: { symbol: "R_25", epoch, quote: 100.004, pip_size: 3 } });
  assert.equal(h.scanner.rows().find((row) => row.symbol === "R_25").sampleSize, initial);
  h.advance(6000);
  h.scanner.handle({ subscription: { id: "sub0" }, tick: { symbol: "R_25", epoch, quote: 100.004, pip_size: 3 } });
  assert.equal(h.scanner.rows().find((row) => row.symbol === "R_25").fresh, false);
});

test("reactive entry accepts positive historical EV without requiring a positive confidence bound", () => {
  const analysis = [row("R_25", "under", 0.55), row("1HZ15V", "over", 0.55)];
  const quotes = [{ ask: 0.5, payout: 0.95 }, { ask: 0.5, payout: 0.95 }];
  const result = evaluatePairQuotes(analysis, quotes, 0.5, 13);
  assert.equal(analysis[0].underEligible, true);
  assert.ok(result.expectedValue > 0);
  assert.ok(result.conservativeExpectedValue < 0);
  assert.equal(result.accepted, true);
  assert.ok(result.conservativeExpectedValue < evaluatePairQuotes(analysis, quotes, 0.5, 1).conservativeExpectedValue);
  const strong = [row("R_25", "under", 0.8), row("1HZ15V", "over", 0.8)];
  assert.equal(evaluatePairQuotes(strong, quotes, 0.5).accepted, true, "one payout need not cover two stakes");
  assert.equal(evaluatePairQuotes(strong, [{ ask: 0.5, payout: 0.6 }, { ask: 0.5, payout: 2 }], 0.5).accepted, false, "reject a losing leg despite profitable partner");
  assert.equal(analyzePairDigits(prices(Array(99).fill(4)), 3).eligible, false);
});

function settlePair(h, profits) {
  const before = h.buys().length;
  h.scanner.requestBestPair(0.5, "USD");
  h.quotes().forEach((q) => h.replyQuote(q));
  assert.equal(h.buys().length, before + 2);
  const buys = h.buys().slice(-2);
  assert.equal(buys.length, 2);
  const ids = buys.map((buy) => 1000 + buy.req_id);
  buys.forEach((buy, i) => h.scanner.handle({ req_id: buy.req_id, buy: { contract_id: ids[i] } }));
  const messages = ids.map((id, i) => ({ proposal_open_contract: { contract_id: id, is_sold: 1, profit: profits[i] } }));
  h.scanner.handle(messages[1]);
  h.scanner.handle(messages[0]);
  return messages;
}

function freshen(h, ms = 4000) {
  h.advance(ms);
  for (const [index, symbol] of ["R_25", "1HZ15V"].entries()) {
    const market = h.scanner.markets.get(symbol);
    const latest = Math.max(...market.points.keys());
    h.scanner.handle({ subscription: { id: `sub${index}` }, tick: { symbol, epoch: latest + ms / 1000, quote: 100.007, pip_size: 3 } });
  }
}

test("pair net result counts once, after both settlements, regardless of leg order", () => {
  const h = harness(); h.initialize();
  const messages = settlePair(h, [2.85, -2]);
  const result = h.scanner.results();
  assert.ok(Math.abs(result.stats.netProfit - 0.85) < 1e-10);
  assert.equal(result.stats.profitable, 1);
  assert.equal(result.stats.losing, 0);
  assert.equal(result.stats.consecutiveLosses, 0);
  messages.forEach((message) => h.scanner.handle(message));
  assert.equal(h.scanner.results().stats.completed, 1);
  result.trades[0].legs[0].profit = -100;
  assert.equal(h.scanner.results().trades[0].legs[0].profit, 2.85);
});

test("two net losses pause an index; three across indices halt the session", () => {
  const h = harness(); h.initialize();
  settlePair(h, [-0.5, -0.5]);
  freshen(h); settlePair(h, [-0.5, -0.5]);
  assert.equal(h.scanner.active, true);
  assert.equal(h.scanner.rows().find((row) => row.symbol === "1HZ15V").status, "Pause indice");
  freshen(h, 61000); settlePair(h, [-0.5, -0.5]);
  const result = h.scanner.results();
  assert.equal(result.trades[0].legs[0].symbol, "R_25");
  assert.equal(result.trades[0].legs[1].symbol, "1HZ15V");
  assert.equal(result.stats.netProfit, -3);
  assert.equal(result.stats.consecutiveLosses, 3);
  assert.equal(h.scanner.active, false);
  assert.equal(h.scanner.busy, false);
  assert.match(h.halts.at(-1), /3 paires/);
  h.scanner.requestBestPair(0.5, "USD");
  assert.equal(h.buys().length, 6);
});

test("a net profitable pair resets the loss streak even when one leg loses", () => {
  const h = harness(); h.initialize();
  settlePair(h, [-0.5, -0.5]);
  freshen(h); settlePair(h, [0.8, -0.5]);
  assert.equal(h.scanner.results().stats.consecutiveLosses, 0);
});

test("profit protection reserves the next pair's whole cost before buying", () => {
  assert.equal(pairProfitProtection({ ...EMPTY_PAIR_STATS, peakProfit: 1.9, netProfit: 1 }, 1), false);
  assert.equal(pairProfitProtection({ ...EMPTY_PAIR_STATS, peakProfit: 2, netProfit: 2 }, 1), false);
  assert.equal(pairProfitProtection({ ...EMPTY_PAIR_STATS, peakProfit: 2, netProfit: 1.8 }, 1), true);
  const h = harness(); h.initialize();
  settlePair(h, [1, 1]);
  freshen(h); settlePair(h, [-0.1, -0.1]);
  freshen(h); h.scanner.requestBestPair(0.5, "USD");
  assert.equal(h.buys().length, 4);
  assert.equal(h.scanner.active, false);
  assert.match(h.halts.at(-1), /Protection des gains/);
});

test("missing settlement profit halts and cannot be counted as zero or a win", () => {
  const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD"); h.quotes().forEach((q) => h.replyQuote(q));
  h.buys().forEach((buy, index) => h.scanner.handle({ req_id: buy.req_id, buy: { contract_id: 100 + index } }));
  h.scanner.handle({ proposal_open_contract: { contract_id: 100, is_sold: 1 } });
  assert.equal(h.scanner.active, false);
  assert.equal(h.scanner.busy, true);
  assert.equal(h.scanner.results().stats.completed, 0);
  assert.match(h.halts.at(-1), /Résultat net/);
});

test("selects the strongest qualifying direction on distinct instruments across the scan", () => {
  const rows = [row("R_25", "under", 0.65), row("1HZ15V", "over", 0.7), row("R_100", "under", 0.8)];
  const selected = selectPairMarkets(rows);
  assert.deepEqual(Array.from(selected, (r) => r.symbol), ["R_100", "1HZ15V"]);
  assert.equal(selectPairMarkets(rows.filter((r) => r.symbol !== "1HZ15V")), null);
  const both = { ...rows[0], overEligible: true };
  assert.equal(selectPairMarkets([both]), null, "same instrument is never a fallback");
  assert.equal(evaluatePairQuotes([both, both], [{ ask: 0.5, payout: 2 }, { ask: 0.5, payout: 2 }], 0.5).accepted, false);
});

test("quotes each instrument's available side, with the corrected barrier", () => {
  const h = harness({ available: (index) => [{ contract_type: index === 0 ? "DIGITUNDER" : "DIGITOVER", min_contract_duration: "1t", last_digit_range: [index === 0 ? 5 : 4] }] });
  h.initialize();
  h.scanner.requestBestPair(0.5, "USD");
  assert.equal(h.quotes().length, 2);
  h.quotes().forEach((q) => h.replyQuote(q));
  assert.deepEqual(h.pending.map((p) => [p.leg.symbol, p.leg.contractType, p.leg.barrier]), [["R_25", "DIGITUNDER", 5], ["1HZ15V", "DIGITOVER", 4]]);
  const legs = h.scanner.results().trades[0].legs;
  assert.deepEqual(Array.from(legs, (leg) => leg.symbol), ["R_25", "1HZ15V"]);
});

test("no pair when only one instrument is eligible or one stream becomes stale", () => {
  const one = harness(); one.initialize();
  one.scanner.markets.delete("1HZ15V");
  one.scanner.requestBestPair(0.5, "USD");
  assert.equal(one.quotes().length, 0);
  const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD");
  const [a, b] = h.quotes(); h.replyQuote(a);
  h.scanner.markets.get("1HZ15V").updatedAt -= 6000;
  h.replyQuote(b);
  assert.equal(h.buys().length, 0);
});

test("rechecks both directional histories before buying, without swapping quoted instruments", () => {
  const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD");
  const [a, b] = h.quotes(); h.replyQuote(b);
  const market = h.scanner.markets.get("R_25");
  market.points = new Map([...market.points.keys()].map((epoch) => [epoch, 100.009]));
  h.replyQuote(a);
  assert.equal(h.buys().length, 0);
});

test("loss cooldown belongs only to the instrument that lost its own contracts", () => {
  const h = harness(); h.initialize();
  settlePair(h, [-0.5, 0.45]);
  freshen(h); settlePair(h, [-0.5, 0.45]);
  freshen(h);
  const rows = h.scanner.rows();
  assert.equal(rows.find((r) => r.symbol === "R_25").status, "Pause indice");
  assert.equal(rows.find((r) => r.symbol === "1HZ15V").overEligible, true);
  const signals = h.signalCount();
  h.scanner.requestBestPair(0.5, "USD");
  assert.equal(h.signalCount(), signals);
  assert.equal(h.scanner.results().stats.consecutiveLosses, 2, "a single winning leg can still leave a losing pair");
});

test("requests and retains 200 ticks, qualifying from 100", () => {
  const h = harness(); h.initialize();
  assert.ok(h.sent.filter((request) => request.ticks_history).every((request) => request.count === 200));
  assert.equal(analyzePairDigits(prices(Array(99).fill(4)), 3).eligible, false);
  assert.equal(analyzePairDigits(prices(Array(100).fill(4)), 3).underEligible, true);
  const recent = analyzePairDigits(prices([...Array(800).fill(9), ...Array(200).fill(4)]), 3);
  assert.equal(recent.sampleSize, 200);
  assert.equal(recent.under, 1);
  h.scanner.handle({ subscription: { id: "sub0" }, tick: { symbol: "R_25", epoch: 1_800_000_001, quote: 100.004, pip_size: 3 } });
  assert.equal(h.scanner.markets.get("R_25").points.size, 200);
});

test("pair funding has no fixed monetary cap and rejects unavailable or invalid balances", () => {
  assert.equal(pairBalanceAllows(6, 6), true);
  assert.equal(pairBalanceAllows(20, 100), true);
  assert.equal(pairBalanceAllows(6, 5.99), false);
  for (const invalid of [null, -1, NaN, Infinity]) assert.equal(pairBalanceAllows(6, invalid), false);
  for (const invalid of [0, -1, NaN, Infinity]) assert.equal(pairBalanceAllows(invalid, 100), false);
});

test("a user stake above 2 is quoted and bought unchanged when funds permit", () => {
  const h = harness(); h.initialize(); h.scanner.requestBestPair(3, "USD");
  assert.equal(h.quotes().length, 2);
  h.quotes().forEach((q) => {
    assert.equal(q.amount, 3);
    h.scanner.handle({ req_id: q.req_id, proposal: { id: `high${q.req_id}`, ask_price: 3, payout: 5.7 } });
  });
  assert.deepEqual(h.buys().map((buy) => buy.price), [3, 3]);
  assert.deepEqual(h.pending.map((pending) => pending.leg.stake), [3, 3]);
  const lowFunds = harness({ funds: 5 }); lowFunds.initialize(); lowFunds.scanner.requestBestPair(3, "USD");
  assert.equal(lowFunds.quotes().length, 0);
});

test("moderate 54-percent histories now send the pair with a small positive historical EV", () => {
  const h = harness(); h.initialize();
  for (const [symbol, side] of [["R_25", "under"], ["1HZ15V", "over"]]) {
    const market = h.scanner.markets.get(symbol);
    market.points = new Map([...market.points.keys()].map((epoch, i) => [epoch, 100 + ((((i * 37) % 100 < 54) === (side === "under")) ? 4 : 5) / 1000]));
  }
  const candidates = selectPairMarkets(h.scanner.rows());
  assert.equal(candidates[0].under, 0.54);
  assert.equal(candidates[1].over, 0.54);
  const evaluation = evaluatePairQuotes(candidates, [{ ask: 0.5, payout: 0.95 }, { ask: 0.5, payout: 0.95 }], 0.5, 13);
  assert.ok(evaluation.expectedValue > 0 && evaluation.expectedValue < evaluation.cost * 0.02);
  assert.ok(evaluation.conservativeExpectedValue < 0);
  h.scanner.requestBestPair(0.5, "USD");
  assert.equal(h.quotes().length, 2);
  h.quotes().forEach((quote) => h.replyQuote(quote));
  assert.equal(h.buys().length, 2);
  assert.equal(h.signalCount(), 1);
  assert.match(h.statuses.at(-1), /EV historique/);
});

test("52-percent candidates still reject quotes whose historical EV is negative", () => {
  const candidates = [row("R_25", "under", 0.52), row("1HZ15V", "over", 0.52)];
  assert.equal(candidates[0].underEligible, true);
  assert.equal(candidates[1].overEligible, true);
  const result = evaluatePairQuotes(candidates, [{ ask: 0.5, payout: 0.95 }, { ask: 0.5, payout: 0.95 }], 0.5, 13);
  assert.ok(result.expectedValue < 0);
  assert.equal(result.accepted, false);
});
