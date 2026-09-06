// Synthetic forward-only checks; no Deriv prices, payouts or latency are simulated.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/match-prediction.ts", import.meta.url), "utf8").replaceAll("export ", "");
const context = vm.createContext({});
vm.runInContext(ts.transpileModule(source + "\nglobalThis.predict = buildMatchPrediction;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
const markdown = readFileSync(new URL("../strategies/matches-top-two-adaptive.md", import.meta.url), "utf8");
const { rules } = JSON.parse(markdown.match(/```json\s*([\s\S]*?)```/)[1]);
let seed = 20260907;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const scenarios = {
  uniform: Array.from({ length: 2050 }, () => Math.floor(random() * 10)),
  artificial_bias: Array.from({ length: 2050 }, () => random() < 0.25 ? 7 : Math.floor(random() * 10)),
  artificial_alternation: Array.from({ length: 2050 }, (_, index) => index % 2 ? 2 : 1),
};
const results = {};
for (const [name, digits] of Object.entries(scenarios)) {
  results[name] = {};
  for (const selectionMode of ["top_two_frequency", "top_two_adaptive"]) {
    let wins = 0, trades = 0, losingStreak = 0, maximumLosingStreak = 0;
    const start = performance.now();
    for (let index = 50; index < digits.length; index += 1) {
      const history = digits.slice(Math.max(0, index - 1000), index).map((digit) => 100 + digit / 1000);
      const { bestCandidate } = context.predict(history, 3, null, { ...rules, selectionMode }, trades);
      if (!bestCandidate) continue;
      trades += 1;
      if (bestCandidate.digit === digits[index]) { wins += 1; losingStreak = 0; }
      else { losingStreak += 1; maximumLosingStreak = Math.max(maximumLosingStreak, losingStreak); }
    }
    results[name][selectionMode] = { trades, wins, winRate: wins / trades, maximumLosingStreak, millisecondsPerDecision: (performance.now() - start) / (digits.length - 50) };
  }
}
console.log(JSON.stringify({ seed: 20260907, note: "Synthetic scenarios only. No evidence of profitability or shorter losing streaks on Deriv. Each prediction excludes its next outcome; model weights only see earlier outcomes.", results }, null, 2));
