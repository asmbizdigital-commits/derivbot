"use client";

import { RUN_STRATEGIES, type RunStrategy } from "@/lib/only-ups-downs";

export function RunStrategyPanel({ strategy, selection, imported, disabled, status, onSelect, onImport }: {
  strategy: RunStrategy; selection: string; imported: RunStrategy | null; disabled: boolean; status: string;
  onSelect: (value: string) => void; onImport: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return <div className="match-strategy-card run-strategy-panel">
    <div><span>Stratégie Only Ups / Only Downs</span><b>{strategy.name}</b>
      <small>{strategy.entryMode === "consecutive" ? `${strategy.confirmationMoves} mouvements consécutifs dans le sens choisi · ${strategy.confirmationMoves + 1} ticks nécessaires` : "Filtre directionnel sur 80 ticks · entrées plus sélectives"} · contrat de {strategy.durationTicks} ticks</small></div>
    <label className="strategy-select">Liste des stratégies<select aria-label="Stratégie Only Ups / Only Downs" value={selection} disabled={disabled} onChange={(event) => onSelect(event.target.value)}>
      {Object.entries(RUN_STRATEGIES).map(([key, profile]) => <option key={key} value={key}>{profile.name}</option>)}
      {imported && <option value="imported">{imported.name} (importée)</option>}
    </select></label>
    <label className="match-strategy-import">Importer .md<input aria-label="Importer une stratégie Only Ups / Only Downs" type="file" accept=".md,text/markdown,text/plain" disabled={disabled} onChange={onImport}/></label>
    <small role="status">{status || "Choisissez une stratégie puis appuyez sur Play. L’import ne lance aucun achat."}</small>
    <small>Le déclencheur observe les prix passés. Il ne garantit pas la série future. La durée du contrat reste indépendante du nombre de mouvements de confirmation.</small>
  </div>;
}
