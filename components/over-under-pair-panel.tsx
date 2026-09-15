"use client";

import type { PairRow } from "@/lib/over-under-pair";

export function OverUnderPairPanel({ rows, stake, currency, stopLoss, running, onStopLoss }: {
  rows: PairRow[]; stake: number; currency: string; stopLoss: number; running: boolean; onStopLoss: (value: number) => void;
}) {
  const percent = (value: number) => `${(value * 100).toFixed(1)} %`;
  return <section className="match-strategy-card pair-scanner" aria-label="Analyse multi-indices Over 5 et Under 4">
    <div><span>TOUTES VOLATILITÉS</span><b>Over 5 + Under 4 · 1 paire à la fois</b>
      <small>Deux contrats de 1 tick sur le même indice. Mise par contrat : {stake.toFixed(2)} {currency} · Total : {(2 * stake).toFixed(2)} {currency}.</small></div>
    <label>Budget de perte de session ({currency})<input type="number" min="0.7" step="0.1" value={stopLoss} disabled={running} onChange={(event) => onStopLoss(Number(event.target.value))}/></label>
    <p>Over 5 : 6–9 · Under 4 : 0–3. Sur le même tick, 4 ou 5 perdent les deux mises. Les achats sont envoyés ensemble ; leur exécution n’est pas atomique.</p>
    <small>Mise fixe par contrat ; martingale, double risque et risque demi-solde ignorés ici. Le marché du graphique reste indépendant du scan.</small>
    <div aria-live="polite"><b>{rows.length} indices découverts · {rows.filter((row) => row.eligible).length} qualifiés</b></div>
    {rows.length ? <div className="pair-scanner-table"><table><thead><tr><th>Indice</th><th>Ticks</th><th>6–9</th><th>0–3</th><th>4–5</th><th>État</th></tr></thead><tbody>
      {rows.map((row) => <tr key={row.symbol}><th scope="row">{row.name}</th><td>{row.sampleSize}</td><td>{percent(row.over)}</td><td>{percent(row.under)}</td><td>{percent(row.middle)}</td><td>{running ? row.status : "Arrêté"}</td></tr>)}
    </tbody></table></div> : <p>Appuyez sur Play pour découvrir les indices et comparer leurs fréquences.</p>}
    <small>Fenêtre : 200 ticks, minimum : 100. Fréquences 6–9 et 0–3 ≥ 30 % chacune, total ≥ 82 % ; confirmation ≥ 80 % sur 50 ticks. Les deux cotations doivent donner une espérance estimée positive après lissage. Ces fréquences ne garantissent pas les prochains résultats.</small>
  </section>;
}
