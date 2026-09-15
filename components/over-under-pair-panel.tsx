"use client";

import type { PairRow, PairTrade, PairStats } from "@/lib/over-under-pair";

export function OverUnderPairPanel({ rows, trades, stats, stake, currency, stopLoss, running, onStopLoss }: {
  trades: PairTrade[]; stats: PairStats;
  rows: PairRow[]; stake: number; currency: string; stopLoss: number; running: boolean; onStopLoss: (value: number) => void;
}) {
  const percent = (value: number) => `${(value * 100).toFixed(1)} %`;
  const money = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)} ${currency}`;
  return <section className="match-strategy-card pair-scanner" aria-label="Analyse multi-indices Under 5 et Over 4">
    <div><span>TOUTES VOLATILITÉS</span><b>Under 5 + Over 4 · deux indices distincts</b>
      <small>Deux contrats de 1 tick, chacun sur son propre indice. Mise par contrat : {stake.toFixed(2)} {currency} · Total : {(2 * stake).toFixed(2)} {currency}.</small></div>
    <label>Budget de perte de session ({currency})<input type="number" min="0.7" step="0.1" value={stopLoss} disabled={running} onChange={(event) => onStopLoss(Number(event.target.value))}/></label>
    <p>Under 5 : 0–4 sur un indice · Over 4 : 5–9 sur un autre. Les deux peuvent gagner ou perdre ; un seul gain peut laisser la paire déficitaire. Les achats sont envoyés ensemble ; leur exécution n’est pas atomique.</p>
    <small>Mise fixe par contrat ; martingale, double risque et risque demi-solde ignorés ici. Le marché du graphique reste indépendant du scan.</small>
    <p>Pause de 60 s sur un indice après 2 contrats perdants consécutifs sur cet indice ; arrêt de session après 3 paires déficitaires consécutives, tous indices confondus. Dès que le pic de bénéfice atteint le coût de 2 paires, arrêt avant une entrée qui pourrait en rendre plus de la moitié.</p>
    <div className="pair-results" aria-label="Résultats nets des paires complètes">
      <span>Paires rentables<b>{stats.profitable}/{stats.completed}</b></span>
      <span>Paires déficitaires<b>{stats.losing}</b></span>
      <span>Pertes consécutives<b>{stats.consecutiveLosses}/3</b></span>
      <span>Résultat net des paires<b>{money(stats.netProfit)}</b></span>
    </div>
    {trades.length > 0 && <details open><summary>Dernières paires de cette session</summary><div className="pair-scanner-table"><table><thead><tr><th>Paire</th><th>État</th><th>Under 5 · indice</th><th>Over 4 · indice</th><th>Net de la paire</th></tr></thead><tbody>
      {trades.slice(0, 10).map((trade) => <tr key={trade.id}><th scope="row">#{trade.id}</th><td>{trade.status === "incomplete" ? "Incomplète · arrêt" : trade.status === "open" ? "En cours" : "Réglée"}</td>{trade.legs.map((leg, index) => <td key={index}><b>{leg.symbol}</b><br/>{leg.failed ? "Refusé" : leg.profit === null ? "En attente" : money(leg.profit)}</td>)}<td>{trade.netProfit === null ? "—" : money(trade.netProfit)}</td></tr>)}
    </tbody></table></div><small>Un contrat perdant peut appartenir à une paire rentable. Les paires incomplètes restent visibles dans le suivi des contrats et sont exclues du total ci-dessus. Ces compteurs repartent à zéro au prochain Play.</small></details>}
    <div aria-live="polite"><b>{rows.length} indices découverts · {rows.filter((row) => row.eligible).length} candidats avant cotations</b></div>
    {rows.length ? <div className="pair-scanner-table"><table><thead><tr><th>Indice</th><th>Ticks</th><th>Under 5 · 0–4</th><th>Over 4 · 5–9</th><th>État</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.symbol}><th scope="row">{row.name}</th><td>{row.sampleSize}</td><td>{percent(row.under)}</td><td>{percent(row.over)}</td><td>{running ? row.status : "Arrêté"}</td></tr>)}
    </tbody></table></div> : <p>Appuyez sur Play pour découvrir les indices et comparer leurs fréquences.</p>}
    <small>Fenêtre : 1 000 ticks, minimum : 500. Pour chaque côté : fréquence ≥ 55 %, confirmée à 54 % sur 200 ticks et 52 % sur 50 ticks. Sélection séparée des instruments Under et Over, obligatoirement différents. Chaque cotation doit passer le filtre prudent ; leur espérance cumulée doit dépasser 2 % du coût, après correction pour l’incertitude et le nombre d’indices. Ce filtre peut rester longtemps sans signal ; aucune rentabilité future n’est garantie.</small>
  </section>;
}
