"use client";

import { useMemo, useRef, useState } from "react";
import { Clock3, GripHorizontal, Minus, Radio, Target, X } from "lucide-react";
import { DEFAULT_MATCH_STRATEGY_RULES, buildMatchPrediction, type MatchStrategyRules } from "@/lib/match-prediction";

type MatchPredictionBalloonProps = {
  open: boolean;
  connected: boolean;
  marketName: string;
  pipSize: number;
  ticks: number[];
  selectedDigit: number;
  strategyRules?: MatchStrategyRules;
  manualDigit?: number | null;
  selectionDisabled?: boolean;
  fixedContract?: { digit: number; duration: number };
  quoteGuard?: { minimumTicks: number; status: string; duration?: number; minimumProbability?: number | null };
  onClose: () => void;
  onOpen: () => void;
  onSelectDigit: (digit: number) => void;
};

type BalloonPosition = { x: number; y: number } | null;

export function MatchPredictionBalloon({ open, connected, marketName, pipSize, ticks, selectedDigit, strategyRules = DEFAULT_MATCH_STRATEGY_RULES, fixedContract, manualDigit = null, selectionDisabled = false, quoteGuard, onClose, onOpen, onSelectDigit }: MatchPredictionBalloonProps) {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState<BalloonPosition>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);
  const liveTicks = useMemo(() => ticks.slice(-1000), [ticks]);
  const lastPrice = liveTicks.at(-1);
  const lastQuote = lastPrice !== undefined && Number.isFinite(lastPrice) && Math.abs(lastPrice) < 1e21
    && Number.isInteger(pipSize) && pipSize >= 0 && pipSize <= 20 ? lastPrice.toFixed(pipSize) : null;
  const lastDigit = lastQuote?.at(-1) ?? null;
  const prediction = useMemo(() => buildMatchPrediction(liveTicks, pipSize, manualDigit, strategyRules), [pipSize, liveTicks, strategyRules, manualDigit]);
  const rankedCandidates = useMemo(() => [...prediction.candidates].sort((left, right) => right.probability - left.probability || left.digit - right.digit), [prediction.candidates]);
  const lastDigitMode = strategyRules.selectionMode === "last_digit_top_two";
  const candidate = prediction.bestCandidate ?? (manualDigit !== null ? prediction.candidates.find((item) => item.digit === manualDigit) ?? null : lastDigitMode ? null : rankedCandidates[0] ?? null);
  const topTwo = rankedCandidates.slice(0, 2);
  const adaptive = strategyRules.selectionMode === "top_two_adaptive";
  const predictionStatus = manualDigit !== null
    ? prediction.ready ? `Digit ${manualDigit} choisi manuellement · seuil vérifié avant achat` : `${prediction.sampleSize}/${strategyRules.minimumTicks} ticks collectés · digit ${manualDigit} manuel`
    : lastDigitMode
    ? !prediction.ready ? `${prediction.sampleSize}/${strategyRules.minimumTicks} ticks collectés` : candidate ? `Dernier digit ${lastDigit} confirmé dans le Top 2` : `Attente : dernier digit ${lastDigit ?? "—"} hors Top 2`
    : adaptive
    ? prediction.ready ? `Choix top 2 · ${prediction.validationSamples ?? 0} prévisions passées comparées` : `${prediction.sampleSize}/${strategyRules.minimumTicks} ticks collectés`
    : prediction.bestCandidate
    ? `Signal qualifié · accord ${prediction.bestCandidate.agreementScore}/5`
    : candidate
      ? `Scan proba avancé · accord ${candidate.agreementScore}/5`
    : `${prediction.sampleSize}/200 ticks collectés`;
  const maximumProbability = Math.max(0.1, ...rankedCandidates.map((item) => item.probability));
  const style = position ? { left: position.x, top: position.y, right: "auto" } : undefined;

  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drag(event: React.PointerEvent<HTMLDivElement>) {
    const origin = dragRef.current;
    if (!origin) return;
    const width = event.currentTarget.parentElement?.offsetWidth ?? 410;
    const height = event.currentTarget.parentElement?.offsetHeight ?? 400;
    const x = Math.min(Math.max(8, origin.left + event.clientX - origin.pointerX), window.innerWidth - width - 8);
    const y = Math.min(Math.max(8, origin.top + event.clientY - origin.pointerY), window.innerHeight - height - 8);
    setPosition({ x, y });
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!open) {
    return <button className="digit-balloon-launcher match-balloon-launcher" onClick={() => { setMinimized(false); onOpen(); }} aria-label="Ouvrir la prédiction Matches"><Target/><span>Prédiction Matches</span></button>;
  }

  return <aside className={`digit-balloon match-balloon ${minimized ? "is-minimized" : ""}`} style={style} role="dialog" aria-modal="false" aria-labelledby="match-balloon-title">
    <div className="digit-balloon-handle" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      <GripHorizontal aria-hidden="true"/>
      <div><span className={connected ? "is-live" : ""}/><b id="match-balloon-title">Prédiction Matches</b></div>
      <button onPointerDown={(event) => event.stopPropagation()} onClick={() => setMinimized((value) => !value)} aria-label={minimized ? "Agrandir le ballon Matches" : "Réduire le ballon Matches"}><Minus/></button>
      <button onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Fermer le ballon Matches"><X/></button>
    </div>

    {!minimized && <div className="digit-balloon-content match-balloon-content">
      <div className="digit-balloon-market">
        <span><small>MARCHÉ</small><b>{marketName}</b></span>
        <span className={connected ? "live" : "offline"}><Radio/>{connected ? "LIVE" : "HORS LIGNE"}</span>
      </div>

      {fixedContract && <p className="digit-balloon-note"><b>DBX V2 · digit fixe {fixedContract.digit} · {fixedContract.duration} tick{fixedContract.duration > 1 ? "s" : ""}</b><br/>Prédiction informative : elle ne modifie pas le digit acheté. Les estimations ci-dessous concernent le prochain tick, pas une échéance de plusieurs ticks.</p>}

      <div className="match-prediction-hero" aria-live="polite">
        <span><small>{manualDigit !== null ? "DIGIT MANUEL" : lastDigitMode ? "DIGIT À MATCHER" : "DIGIT ESTIMÉ"}</small><strong>{candidate?.digit ?? "-"}</strong></span>
        <div><small>{lastDigitMode ? "FRÉQUENCE OBSERVÉE" : adaptive ? "ESTIMATION NON CALIBRÉE" : "PROBABILITÉ MODÉLISÉE"}</small><b>{candidate ? `${(candidate.probability * 100).toFixed(1)}%` : "-"}</b><p>{predictionStatus}</p></div>
      </div>

      {quoteGuard && <p className="digit-balloon-note" aria-live="polite"><b>Contrôle payout V3.1 · {Math.min(liveTicks.length, quoteGuard.minimumTicks)}/{quoteGuard.minimumTicks} ticks</b><br/>Seuil : {quoteGuard.minimumProbability == null ? "automatique selon le payout" : `${(quoteGuard.minimumProbability * 100).toFixed(2)}% (manuel)`} · Durée : {quoteGuard.duration ?? 1} tick(s)<br/>{quoteGuard.minimumProbability == null ? "Comparaison : estimation prudente et payout." : "Comparaison : estimation du modèle ; le score le plus faible pendant la cotation est retenu."}<br/>{quoteGuard.status}{(quoteGuard.duration ?? 1) > 1 && <><br/>Estimation du prochain tick, non calibrée pour cette durée.</>}</p>}

      <div className="match-refresh-status match-last-tick" aria-live="polite" aria-atomic="true"><Clock3/><span>Dernier digit reçu <small>{lastQuote === null ? "En attente de tick" : `Dernier tick : ${lastQuote}`}</small></span><b aria-label={`Dernier digit reçu : ${lastDigit ?? "indisponible"}`}>{lastDigit ?? "—"}</b></div>

      {lastDigitMode && <div className="match-model-grid match-top-two-observed" aria-label="Les deux digits les plus fréquents">
        {topTwo.map((item, index) => <span key={item.digit}><small>MOST APPEARING #{index + 1}</small><b>{item.digit} · {(item.probability * 100).toFixed(1)}%</b></span>)}
      </div>}
      {candidate && !lastDigitMode && <div className="match-model-grid">
        <span><small>{adaptive ? "RÉCENT 20" : "COURT 50"}</small><b>{(candidate.shortProbability * 100).toFixed(1)}%</b></span>
        <span><small>{adaptive ? `LISSÉ ${strategyRules.windowSize}` : "MOYEN 160"}</small><b>{(candidate.mediumProbability * 100).toFixed(1)}%</b></span>
        <span><small>{adaptive ? "FRÉQUENCE OBSERVÉE" : "LONG 500"}</small><b>{((adaptive ? candidate.observedFrequency ?? 0 : candidate.longProbability) * 100).toFixed(1)}%</b></span>
        <span><small>TRANSITION</small><b>{(candidate.transitionProbability * 100).toFixed(1)}%</b></span>
      </div>}

      <div className="match-candidate-grid" role="group" aria-label={lastDigitMode ? "Fréquences observées Matches" : "Classement probabiliste Matches"}>
        {rankedCandidates.map((item) => <button key={item.digit} disabled={!!fixedContract || selectionDisabled} className={`${candidate?.digit === item.digit ? "predicted" : ""} ${selectedDigit === item.digit ? "selected" : ""}`} onClick={() => { if (!fixedContract && !selectionDisabled) onSelectDigit(item.digit); }} aria-label={`Digit ${item.digit}, ${lastDigitMode ? "fréquence observée" : "probabilité modélisée"} ${(item.probability * 100).toFixed(1)} pour cent`}>
          <b>{item.digit}</b><span>{(item.probability * 100).toFixed(1)}%</span><i style={{ height: `${Math.max(4, (item.probability / maximumProbability) * 100)}%` }}/>
        </button>)}
      </div>

      <p className="digit-balloon-note">{lastDigitMode ? "Classement recalculé à chaque tick. Les fréquences décrivent les ticks passés ; elles ne garantissent pas le prochain digit." : "Estimation recalculée à chaque nouveau tick. Le flux Deriv utilise un RNG sécurisé: ce résultat ne garantit pas le prochain digit."}</p>
    </div>}
  </aside>;
}
