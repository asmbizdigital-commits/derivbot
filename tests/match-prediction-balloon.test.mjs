import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const model = read("../lib/match-prediction.ts").replaceAll("export ", "");
const component = read("../components/match-prediction-balloon.tsx").replace(/^import .*;\n/gm, "").replace("export function", "function");
const Icon = () => null;
const context = vm.createContext({ React, useMemo: React.useMemo, useRef: React.useRef, useState: React.useState, Clock3: Icon, GripHorizontal: Icon, Minus: Icon, Radio: Icon, Target: Icon, X: Icon });
vm.runInContext(ts.transpileModule(model + component + "\nglobalThis.Component = MatchPredictionBalloon; globalThis.rules = { ...DEFAULT_MATCH_STRATEGY_RULES, selectionMode: 'last_digit_top_two', minimumTicks: 50, windowSize: 50, minimumProbability: 0 };", { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
const render = (digits, extra = {}) => renderToStaticMarkup(React.createElement(context.Component, { open: true, connected: true, marketName: "Volatility 50 (1s)", pipSize: 3, ticks: digits.map((digit) => 100 + digit / 1000), selectedDigit: 7, strategyRules: context.rules, onClose() {}, onOpen() {}, onSelectDigit() {}, ...extra }));

test("V4 popup displays the qualified last digit and both observed frequencies", () => {
  const html = render([...Array(30).fill(7), ...Array(20).fill(3)]);
  assert.match(html, /DIGIT À MATCHER<\/small><strong>3<\/strong>/);
  assert.match(html, /Dernier digit reçu : 3/);
  assert.match(html, /MOST APPEARING #1<\/small><b>7 · 60\.0%/);
  assert.match(html, /MOST APPEARING #2<\/small><b>3 · 40\.0%/);
  assert.match(html, /Dernier digit 3 confirmé dans le Top 2/);
  assert.doesNotMatch(html, /PROBABILITÉ MODÉLISÉE|prévisions passées comparées/);
});

test("V4 popup never presents an unqualified fallback digit as a trade signal", () => {
  const html = render([...Array(30).fill(7), ...Array(19).fill(3), 9]);
  assert.match(html, /DIGIT À MATCHER<\/small><strong>-<\/strong>/);
  assert.match(html, /Attente : dernier digit 9 hors Top 2/);
  assert.match(html, /MOST APPEARING #1/);
  assert.match(render([7]), /1\/50 ticks collectés/);
  assert.match(render([]), /Dernier digit reçu : indisponible/);
  assert.match(render(Array(50).fill(0)), /Dernier tick : 100\.000/);
});

test("V3 popup keeps its adaptive estimate and the latest observed digit", () => {
  const html = render([...Array(30).fill(7), ...Array(20).fill(3)], { strategyRules: { ...context.rules, selectionMode: "top_two_adaptive" } });
  assert.match(html, /DIGIT ESTIMÉ/);
  assert.match(html, /ESTIMATION NON CALIBRÉE/);
  assert.match(html, /Dernier digit reçu : 3/);
  assert.doesNotMatch(html, /MOST APPEARING #1/);
});
