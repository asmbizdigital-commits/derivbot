import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/over-under-pair.ts", import.meta.url), "utf8").replaceAll("export ", "");
const context = vm.createContext({ setInterval: () => 1, clearInterval() {} });
vm.runInContext(ts.transpileModule(source + "\nglobalThis.api = { OverUnderPairScanner, analyzePairDigits, volatilitySymbols, supportsPair, evaluatePairQuotes };", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
const { OverUnderPairScanner, analyzePairDigits, volatilitySymbols, supportsPair, evaluatePairQuotes } = context.api;
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
      const digits = Array.from({ length: 200 }, (_, i) => i % 2 ? 7 : 2);
      if (index === 0) for (let i = 0; i < 20; i++) digits[i * 10] = 4;
      scanner.handle({ req_id: request.req_id, subscription: { id: `sub${index}` }, pip_size: 3,
        history: { prices: prices(digits), times: digits.map((_, i) => now / 1000 - (199 - i)) } });
    }
  }
  const quotes = () => sent.filter((request) => request.proposal === 1).slice(-2);
  const buys = () => sent.filter((request) => request.buy);
  const replyQuote = (request, payout = 1.3) => scanner.handle({ req_id: request.req_id, proposal: { id: `quote${request.req_id}`, ask_price: 0.5, payout } });
  return { scanner, sent, pending, halts, statuses, initialize, quotes, buys, replyQuote, signalCount: () => signals,
    advance: (ms) => { now += ms; scanner.pulse(); }, setAllowed: (value) => { allow = value; } };
}

test("strict barriers: 4 and 5 are in neither winning set, precision retains zero", () => {
  const result = analyzePairDigits(prices(Array.from({ length: 200 }, (_, i) => i % 10)), 3);
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
  const analysis = analyzePairDigits(prices(Array.from({ length: 200 }, (_, i) => i % 2 ? 7 : 2)), 3);
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
  h.scanner.handle({ proposal_open_contract: { contract_id: 123, is_sold: 1 } });
  assert.equal(h.scanner.busy, false);
});

test("Stop retains buy correlation; missing acknowledgement blocks new pairs", () => {
  const h = harness(); h.initialize(); h.scanner.requestBestPair(0.5, "USD"); h.quotes().forEach((q) => h.replyQuote(q));
  const [a, b] = h.buys(); h.scanner.stop();
  h.scanner.handle({ req_id: a.req_id, buy: { contract_id: 12 } });
  h.scanner.handle({ proposal_open_contract: { contract_id: 12, status: "won" } });
  assert.equal(h.scanner.busy, true);
  h.advance(16000); assert.equal(h.halts.length, 1); assert.equal(h.scanner.uncertain, true);
  h.scanner.handle({ req_id: b.req_id, buy: { contract_id: 13 } });
  assert.equal(h.scanner.busy, true);
  h.scanner.handle({ proposal_open_contract: { contract_id: 13, status: "lost" } });
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
