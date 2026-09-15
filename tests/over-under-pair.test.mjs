import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/over-under-pair.ts", import.meta.url), "utf8").replaceAll("export ", "");
const context = vm.createContext({ setInterval: () => 1, clearInterval() {} });
vm.runInContext(ts.transpileModule(source + "\nglobalThis.api = { OverUnderPairScanner, analyzePairDigits, volatilitySymbols, supportsPair, evaluatePairQuotes, pairProfitProtection, EMPTY_PAIR_STATS };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
const { OverUnderPairScanner, analyzePairDigits, volatilitySymbols, supportsPair, evaluatePairQuotes, pairProfitProtection, EMPTY_PAIR_STATS } = context.api;
const prices = (digits) => digits.map((digit) => 100 + digit / 1000);
const contracts = ["DIGITOVER", "DIGITUNDER"].map((contract_type) => ({ contract_type, min_contract_duration: "1t", max_contract_duration: "10t" }));

function harness({ funds = 100, allow = true } = {}) {
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
      scanner.handle({ req_id: sent.at(-1).req_id, contracts_for: { available: contracts } });
    }
    for (let index = 0; index < 2; index++) {
      scanner.pulse();
      const request = sent.at(-1);
      const digits = Array.from({ length: 1000 }, (_, i) => i % 2 ? 7 : 2);
      if (index === 0) for (let i = 0; i < 100; i++) digits[i * 10] = 4;
      scanner.handle({ req_id: request.req_id, subscription: { id: `sub${index}` }, pip_size: 3,
        history: { prices: prices(digits), times: digits.map((_, i) => now / 1000 - (999 - i)) } });
    }
  }
  const quotes = () => sent.filter((request) => request.proposal === 1).slice(-2);
  const buys = () => sent.filter((request) => request.buy);
  const replyQuote = (request, payout = 1.3) => scanner.handle({ req_id: request.req_id, proposal: { id: `quote${request.req_id}`, ask_price: 0.5, payout } });
  return { scanner, sent, pending, halts, statuses, initialize, quotes, buys, replyQuote, signalCount: () => signals,
    advance: (ms) => { now += ms; scanner.pulse(); }, setAllowed: (value) => { allow = value; } };
}

test("strict barriers: 4 and 5 are in neither winning set, precision retains zero", () => {
  const result = analyzePairDigits(prices(Array.from({ length: 1000 }, (_, i) => i % 10)), 3);
  assert.equal(result.over, 0.4); assert.equal(result.under, 0.4);
  assert.ok(Math.abs(result.middle - 0.2) < 1e-12);
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
  assert.equal(supportsPair(contracts), true);
  assert.equal(supportsPair(contracts.slice(0, 1)), false);
  assert.equal(supportsPair(contracts.map((c) => ({ ...c, min_contract_duration: "5t" }))), false);
});

test("ranks independent streams and sends exactly two buys only after both quotes", () => {
  const h = harness(); h.initialize();
  assert.equal(h.scanner.rows()[0].symbol, "1HZ15V");
  h.scanner.requestBestPair(0.5, "USD");
  const [over, under] = h.quotes();
  assert.deepEqual([over.contract_type, over.barrier, under.contract_type, under.barrier], ["DIGITOVER", 5, "DIGITUNDER", 4]);
  assert.equal(over.underlying_symbol, under.underlying_symbol);
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
  const analysis = analyzePairDigits(prices(Array.from({ length: 1000 }, (_, i) => i % 2 ? 7 : 2)), 3);
  assert.equal(evaluatePairQuotes(analysis, [{ ask: 0.5, payout: 0.7 }, { ask: 0.5, payout: 0.7 }], 0.5).accepted, false);
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

test("rejects a positive point estimate when uncertainty or combined costs erase the edge", () => {
  const digits = Array.from({ length: 1000 }, (_, i) => i % 2 ? 7 : 2);
  for (let i = 0; i < 100; i++) digits[i * 10] = 4;
  const analysis = analyzePairDigits(prices(digits), 3);
  const quotes = [{ ask: 2, payout: 4.85 }, { ask: 2, payout: 4.85 }];
  const result = evaluatePairQuotes(analysis, quotes, 2, 13);
  assert.equal(analysis.eligible, true);
  assert.ok(result.expectedValue > 0);
  assert.ok(result.conservativeExpectedValue < 0);
  assert.equal(result.accepted, false);
  assert.ok(result.conservativeExpectedValue < evaluatePairQuotes(analysis, quotes, 2, 1).conservativeExpectedValue);
  assert.equal(evaluatePairQuotes(analysis, [{ ask: 2, payout: 3.9 }, { ask: 2, payout: 20 }], 2).accepted, false);
  assert.equal(analyzePairDigits(prices(digits.slice(-499)), 3).eligible, false);
});

function settlePair(h, profits) {
  h.scanner.requestBestPair(0.5, "USD");
  h.quotes().forEach((q) => h.replyQuote(q));
  const buys = h.buys().slice(-2);
  assert.equal(buys.length, 2);
  const ids = buys.map((buy) => 1000 + buy.req_id);
  buys.forEach((buy, i) => h.scanner.handle({ req_id: buy.req_id, buy: { contract_id: ids[i] } }));
  const messages = ids.map((id, i) => ({ proposal_open_contract: { contract_id: id, is_sold: 1, profit: profits[i] } }));
  h.scanner.handle(messages[1]);
  h.scanner.handle(messages[0]);
  return messages;
}

function freshen(h) {
  h.advance(4000);
  for (const [index, symbol] of ["R_25", "1HZ15V"].entries()) {
    const market = h.scanner.markets.get(symbol);
    const latest = Math.max(...market.points.keys());
    h.scanner.handle({ subscription: { id: `sub${index}` }, tick: { symbol, epoch: latest + 4, quote: 100.007, pip_size: 3 } });
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
  freshen(h); settlePair(h, [-0.5, -0.5]);
  const result = h.scanner.results();
  assert.equal(result.trades[0].symbol, "R_25");
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
