import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const source = readFileSync(new URL("../components/over-under-pair-panel.tsx", import.meta.url), "utf8")
  .replace(/^import type .*;$/m, "").replace("export function", "function");
const context = vm.createContext({ React });
vm.runInContext(ts.transpileModule(source + "\nglobalThis.Panel = OverUnderPairPanel;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText, context);
const props = { rows: [], trades: [], stats: { completed: 0, profitable: 0, losing: 0, netProfit: 0, peakProfit: 0, consecutiveLosses: 0 }, stake: 5, currency: "USD", running: false, onStake() {} };
const elements = (node) => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];

test("the strategy panel edits amounts above 2 and displays their actual combined cost", () => {
  let entered;
  const tree = context.Panel({ ...props, onStake: (value) => { entered = value; } });
  const inputs = elements(tree).filter((node) => node.type === "input");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].props.max, undefined);
  assert.equal(inputs[0].props.value, 5);
  assert.equal(inputs[0].props.disabled, false);
  inputs[0].props.onChange({ target: { value: "7.50" } });
  assert.equal(entered, 7.5);
  const html = renderToStaticMarkup(React.createElement(context.Panel, { ...props, stake: entered }));
  assert.match(html, /Mise par contrat : 7\.50 USD/);
  assert.match(html, /Total calculé : 15\.00 USD/);
  assert.doesNotMatch(html, /Budget de perte/);
});
