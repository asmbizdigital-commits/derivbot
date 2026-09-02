"use client";

import { useMemo, useRef, useState } from "react";
import { Activity, GripHorizontal, Minus, Radio, X } from "lucide-react";
import { getUnderEightTransitionState } from "@/lib/over-under-prediction";

type DigitPredictionBalloonProps = {
  open: boolean;
  connected: boolean;
  marketName: string;
  pipSize: number;
  price: number | null;
  selectedDigit: number;
  showOverUnderModel: boolean;
  ticks: number[];
  onClose: () => void;
  onOpen: () => void;
  onSelectDigit: (digit: number) => void;
};

type BalloonPosition = { x: number; y: number } | null;

function getLastDigit(price: number, pipSize: number) {
  return Number(price.toFixed(pipSize).at(-1));
}

export function DigitPredictionBalloon({
  open,
  connected,
  marketName,
  pipSize,
  price,
  selectedDigit,
  showOverUnderModel,
  ticks,
  onClose,
  onOpen,
  onSelectDigit,
}: DigitPredictionBalloonProps) {
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState<BalloonPosition>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; left: number; top: number } | null>(null);

  const stats = useMemo(() => {
    const frequencyTicks = ticks.slice(-80);
    const counts = Array.from({ length: 10 }, () => 0);
    frequencyTicks.forEach((tick) => {
      counts[getLastDigit(tick, pipSize)] += 1;
    });
    const total = frequencyTicks.length;
    const percentages = counts.map((count) => total ? (count / total) * 100 : 0);
    const predictedDigit = total ? percentages.indexOf(Math.max(...percentages)) : null;
    const coldDigit = total ? percentages.indexOf(Math.min(...percentages)) : null;
    return { percentages, predictedDigit, coldDigit, total };
  }, [pipSize, ticks]);
  const underEightTransition = useMemo(() => getUnderEightTransitionState(ticks, pipSize), [pipSize, ticks]);
  const underEightStatus = underEightTransition.state === "triggered"
    ? `Transition 9 → ${underEightTransition.lastDigit} · entrée déclenchée`
    : underEightTransition.state === "armed"
      ? "Digit 9 détecté · attente de sa sortie"
      : underEightTransition.state === "waiting_for_9"
        ? "En attente du digit 9"
        : "Collecte des ticks en cours";

  const lastDigit = price === null ? null : getLastDigit(price, pipSize);
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
    const width = event.currentTarget.parentElement?.offsetWidth ?? 360;
    const height = event.currentTarget.parentElement?.offsetHeight ?? 300;
    const x = Math.min(Math.max(8, origin.left + event.clientX - origin.pointerX), window.innerWidth - width - 8);
    const y = Math.min(Math.max(8, origin.top + event.clientY - origin.pointerY), window.innerHeight - height - 8);
    setPosition({ x, y });
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!open) {
    return <button className="digit-balloon-launcher" onClick={() => { setMinimized(false); onOpen(); }} aria-label="Ouvrir la prédiction des digits"><Activity/><span>Prédiction digits</span></button>;
  }

  return <aside className={`digit-balloon ${minimized ? "is-minimized" : ""}`} style={style} role="dialog" aria-modal="false" aria-labelledby="digit-balloon-title">
    <div className="digit-balloon-handle" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}>
      <GripHorizontal aria-hidden="true"/>
      <div><span className={connected ? "is-live" : ""}/><b id="digit-balloon-title">Prédiction des digits</b></div>
      <button onPointerDown={(event) => event.stopPropagation()} onClick={() => setMinimized((value) => !value)} aria-label={minimized ? "Agrandir le ballon" : "Réduire le ballon"}><Minus/></button>
      <button onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Fermer le ballon"><X/></button>
    </div>

    {!minimized && <div className="digit-balloon-content">
      <div className="digit-balloon-market">
        <span><small>MARCHÉ</small><b>{marketName}</b></span>
        <span className={connected ? "live" : "offline"}><Radio/>{connected ? "LIVE" : "HORS LIGNE"}</span>
      </div>

      <div className="digit-prediction-summary" aria-live="polite">
        <span><small>DERNIER DIGIT</small><b>{lastDigit ?? "-"}</b></span>
        <div><small>FRÉQUENCE LA PLUS FORTE</small><strong>{stats.predictedDigit ?? "-"}</strong><p>{stats.predictedDigit === null ? "Collecte des ticks en cours" : `${stats.percentages[stats.predictedDigit].toFixed(1)}% sur ${stats.total} ticks`}</p></div>
      </div>

      {showOverUnderModel && <div className={`over-under-model ${underEightTransition.state === "triggered" ? "ready" : "waiting"}`} aria-live="polite">
        <div><small>STRATÉGIE OVER / UNDER</small><b>Under 8</b></div>
        <span><small>DÉCLENCHEUR</small><b>9 → autre digit</b></span>
        <span><small>CHANCE NOMINALE</small><b>80%</b></span>
        <p>{underEightStatus} · le contrat porte sur le tick suivant.</p>
      </div>}

      <div className="digit-probability-grid" role="group" aria-label="Fréquence des derniers chiffres">
        {stats.percentages.map((percentage, digit) => <button
          key={digit}
          className={`${selectedDigit === digit ? "selected" : ""} ${stats.predictedDigit === digit ? "hot" : ""} ${stats.coldDigit === digit ? "cold" : ""} ${lastDigit === digit ? "current" : ""}`}
          onClick={() => onSelectDigit(digit)}
          aria-label={`Digit ${digit}, fréquence ${percentage.toFixed(1)} pour cent`}
        >
          <b>{digit}</b>
          <span>{percentage.toFixed(1)}%</span>
          <i style={{ height: `${Math.max(3, percentage * 3)}%` }}/>
        </button>)}
      </div>

      <div className="digit-balloon-legend"><span><i className="hot"/>Plus fréquent</span><span><i className="cold"/>Moins fréquent</span><span>{stats.total}/80 ticks</span></div>
      <p className="digit-balloon-note">Analyse statistique du module officiel Deriv. Une fréquence observée ne garantit pas le prochain digit.</p>
    </div>}
  </aside>;
}
