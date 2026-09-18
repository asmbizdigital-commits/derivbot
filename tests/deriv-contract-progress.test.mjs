import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const source = read("../lib/deriv-contract-progress.ts").replaceAll("export ", "");
const context = vm.createContext({});
vm.runInContext(ts.transpileModule(source + "\nglobalThis.update = updateContractProgress;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
const update = context.update;

test("a one-tick contract waits for entry, then expiry, then separate settlement", () => {
  let state = update({ duration: 1 }, { tick_count: 1, entry_spot: null, is_expired: 0 });
  assert.equal(state.contractPhase, "entry", "tick_count=1 must not indicate a completed tick");
  state = update(state, { entry_spot: "100.000", entry_spot_time: 100, is_expired: 0 });
  assert.equal(state.contractPhase, "active");
  state = update(state, { tick_count: 1, is_expired: 1, exit_spot_time: 101 });
  assert.equal(state.duration, 1);
  assert.equal(state.contractPhase, "settlement");
  assert.equal(state.entryTime, 100); assert.equal(state.exitTime, 101);
  assert.equal(state.status, undefined, "expiry alone must never book a win or loss");
  state = update(state, { is_expired: 0 });
  assert.equal(state.contractPhase, "settlement", "partial/stale messages must not rewind the phase");
});

test("server duration replaces recovery fallback and market ticks cannot complete a contract", () => {
  let state = update({ duration: 0 }, { tick_count: 7 });
  assert.equal(state.duration, 7);
  state = update(state, { entry_spot: "0", tick_stream: Array(20).fill({ tick: 100 }) });
  assert.equal(state.contractPhase, "active");
  for (const tick_count of [0, -1, 1.2, NaN, Infinity]) assert.equal(update(state, { tick_count }).duration, 7);
  assert.equal(update(state, {}).contractPhase, "active");
});

test("real contract handler uses the confirmed duration and keeps expiry open until sold", () => {
  const page = read("../app/page.tsx");
  const begin = page.indexOf("        setDerivDeals", page.indexOf("      const openContract ="));
  const end = page.indexOf("        if (isSold) {", begin);
  let deals = [{ contractId: 42, duration: 1, status: "open", buyPrice: 1, entrySpot: null }];
  const ctx = vm.createContext({ updateContractProgress: update, openContract: { contract_id: 42, tick_count: 1, is_expired: 1, entry_spot_time: 100, exit_spot_time: 101 }, profit: null, isSold: false,
    toNumber: (value) => value == null ? null : Number(value), setDerivDeals: (fn) => { deals = fn(deals); } });
  vm.runInContext(page.slice(begin, end), ctx);
  assert.equal(deals[0].status, "open");
  assert.equal(deals[0].contractPhase, "settlement");
  assert.equal(deals[0].duration, 1);
  assert.equal(deals[0].entryTime, 100);
  ctx.isSold = true; ctx.profit = -1; ctx.openContract.status = "lost";
  vm.runInContext(page.slice(begin, end), ctx);
  assert.equal(deals[0].status, "lost");
});
