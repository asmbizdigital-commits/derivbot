export type PairLeg = { contractType: "DIGITOVER" | "DIGITUNDER"; barrier: number; stake: number; symbol: string; duration: number; pair: true };
export type PairAnalysis = {
  sampleSize: number; over: number; under: number;
  underEligible: boolean; overEligible: boolean;
  overEstimate: number; underEstimate: number; eligible: boolean;
};
export type PairTrade = {
  id: number; cost: number;
  expectedValue: number; conservativeExpectedValue: number;
  status: "open" | "settled" | "incomplete"; netProfit: number | null;
  legs: (PairLeg & { name: string; contractId: number | null; profit: number | null; failed: boolean })[];
};
export type PairStats = { completed: number; profitable: number; losing: number; netProfit: number; peakProfit: number; consecutiveLosses: number };
export const EMPTY_PAIR_STATS: PairStats = { completed: 0, profitable: 0, losing: 0, netProfit: 0, peakProfit: 0, consecutiveLosses: 0 };

export function pairProfitProtection(stats: PairStats, nextCost: number) {
  // Reserve the full possible loss BEFORE re-entry, after profits reach two pairs.
  return stats.peakProfit >= 2 * nextCost && stats.netProfit - nextCost < stats.peakProfit * 0.5 - 1e-8;
}
export type PairMarket = {
  symbol: string; name: string; pipSize: number | null;
  points: Map<number, number>; updatedAt: number; status: string; supportsUnder: boolean; supportsOver: boolean;
};
export type PairRow = PairAnalysis & { symbol: string; name: string; status: string; fresh: boolean };
type Message = Record<string, any>; // API envelopes are validated at each boundary below.

// Tuple order everywhere: Under 5 on the first instrument, Over 4 on the second.
export const PAIR_SIDES = [
  { contractType: "DIGITUNDER", barrier: 5 },
  { contractType: "DIGITOVER", barrier: 4 },
] as const;

export function analyzePairDigits(prices: number[], pipSize: number | null): PairAnalysis {
  const empty = { sampleSize: 0, over: 0, under: 0, overEstimate: 0.5, underEstimate: 0.5, underEligible: false, overEligible: false, eligible: false };
  if (pipSize === null || !Number.isInteger(pipSize) || pipSize < 0 || pipSize > 12) return empty;
  const sample = prices.slice(-1000);
  if (!sample.length || sample.some((price) => !Number.isFinite(price) || Math.abs(price) >= 1e21)) return empty;
  const digits = sample.map((price) => Number(price.toFixed(pipSize).at(-1)));
  const underCount = digits.filter((digit) => digit < 5).length;
  const overCount = digits.length - underCount;
  const under = underCount / digits.length;
  const over = overCount / digits.length;
  const qualifies = (wins: (digit: number) => boolean, frequency: number) => digits.length >= 500 && frequency >= 0.55
    && digits.slice(-200).filter(wins).length / 200 >= 0.54
    && digits.slice(-50).filter(wins).length / 50 >= 0.52;
  const underEligible = qualifies((digit) => digit < 5, under);
  const overEligible = qualifies((digit) => digit > 4, over);
  return { sampleSize: digits.length, over, under,
    overEstimate: (overCount + 25) / (digits.length + 50),
    underEstimate: (underCount + 25) / (digits.length + 50),
    underEligible, overEligible, eligible: underEligible || overEligible };
}

function lowerWinRate(row: PairAnalysis, side: "under" | "over", marketCount: number) {
  // Marginal Hoeffding bounds adjusted across both directions and all markets.
  // Fixed independent sample assumption; repeated live selection is not a guarantee.
  const count = Number.isFinite(marketCount) ? Math.max(1, marketCount) : 1;
  const margin = row.sampleSize > 0 ? Math.sqrt(Math.log(2 * count / 0.05) / (2 * row.sampleSize)) : 1;
  return Math.max(0, Math.min((side === "under" ? row.underEstimate : row.overEstimate), row[side] - margin));
}

export function selectPairMarkets(rows: PairRow[], marketCount = rows.length): [PairRow, PairRow] | null {
  let best: [PairRow, PairRow] | null = null;
  let bestScore = -Infinity;
  // Consider every ordered combination, excluding the same instrument.
  const ordered = [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol));
  for (const under of ordered) {
    if (!under.eligible || !under.underEligible || !under.fresh) continue;
    for (const over of ordered) {
      if (over.symbol === under.symbol || !over.eligible || !over.overEligible || !over.fresh) continue;
      const score = lowerWinRate(under, "under", marketCount) + lowerWinRate(over, "over", marketCount);
      if (score > bestScore) { bestScore = score; best = [under, over]; }
    }
  }
  return best;
}

export function volatilitySymbols(items: Message[]) {
  const seen = new Set<string>();
  return items.flatMap((item) => {
    const symbol = item.underlying_symbol ?? item.symbol;
    const name = item.underlying_symbol_name ?? item.display_name ?? symbol;
    if (typeof symbol !== "string" || typeof name !== "string" || seen.has(symbol)
      || !(/^(R_\d+|1HZ\d+V)$/.test(symbol) || /\bvolatility\s+\d/i.test(name))
      || item.is_trading_suspended === 1 || item.is_trading_suspended === true
      || item.exchange_is_open === 0 || item.exchange_is_open === false) return [];
    seen.add(symbol);
    // active_symbols may call the decimal step "pip_size" (0.01), whereas
    // history/tick pip_size is a decimal count (2). Support both envelopes.
    const pip = Number(item.pip ?? item.pip_size);
    const precision = Number.isInteger(item.pip_size) ? item.pip_size : pip > 0 ? -Math.log10(pip) : NaN;
    const pipSize = Number.isFinite(precision) && Math.abs(precision - Math.round(precision)) < 1e-8 && precision >= 0 && precision <= 12 ? Math.round(precision) : null;
    return [{ symbol, name, pipSize }];
  });
}

export function supportsPairLeg(contracts: Message[], type: PairLeg["contractType"]) {
  return contracts.some((contract) => {
    const minimum = String(contract.min_contract_duration ?? "");
    const maximum = String(contract.max_contract_duration ?? "");
    const barrier = type === "DIGITUNDER" ? 5 : 4;
    return contract.contract_type === type && (!Array.isArray(contract.last_digit_range) || contract.last_digit_range.map(Number).includes(barrier))
      && /^\d+t$/.test(minimum) && Number(minimum.slice(0, -1)) <= 1
      && (!/^\d+t$/.test(maximum) || Number(maximum.slice(0, -1)) >= 1);
  });
}

export function evaluatePairQuotes(rows: [PairRow, PairRow], quotes: { ask: number; payout: number }[], stake: number, marketCount = 2) {
  const valid = rows[0].symbol !== rows[1].symbol && quotes.length === 2 && Number.isFinite(stake) && stake >= 0.35 && quotes.every((quote) => Number.isFinite(quote.ask) && quote.ask > 0 && quote.ask <= stake + 1e-8 && Number.isFinite(quote.payout) && quote.payout > quote.ask);
  const cost = quotes.reduce((sum, quote) => sum + quote.ask, 0);
  const expectedValue = quotes.length === 2 ? rows[0].underEstimate * quotes[0].payout + rows[1].overEstimate * quotes[1].payout - cost : -Infinity;
  const underLower = lowerWinRate(rows[0], "under", marketCount);
  const overLower = lowerWinRate(rows[1], "over", marketCount);
  const legExpectedValues = quotes.length === 2 ? [underLower * quotes[0].payout - quotes[0].ask, overLower * quotes[1].payout - quotes[1].ask] : [-Infinity, -Infinity];
  const conservativeExpectedValue = legExpectedValues.reduce((sum, value) => sum + value, 0);
  // With 50/50 barriers, one winning payout may NOT cover both stakes.
  // Require each leg to pass its own quote check, then check their summed EV.
  return { cost, expectedValue, conservativeExpectedValue, underLower, overLower, legExpectedValues,
    accepted: valid && rows.every((row) => row.eligible && row.fresh) && rows[0].underEligible && rows[1].overEligible
      && legExpectedValues.every((value) => value > 0) && conservativeExpectedValue > cost * 0.02 };
}

type PairOptions = {
  send: (message: Message) => void; nextId: () => number;
  onUpdate: () => void; onStatus: (message: string) => void; onHalt: (message: string) => void;
  canBuy: (totalCost: number) => boolean;
  onBuyRequest: (id: number, leg: PairLeg) => void;
  onSignal: () => void;
  onResults?: (trades: PairTrade[], stats: PairStats) => void;
  now?: () => number;
};
type Request = { kind: "symbols" | "contracts" | "history"; symbol?: string; sentAt: number };
type Quote = { id: string; ask: number; payout: number; receivedAt: number };

/** Shared account socket, isolated request IDs. No automatic retry of purchases. */
export class OverUnderPairScanner {
  readonly markets = new Map<string, PairMarket>();
  private requests = new Map<number, Request>();
  private ownedIds = new Set<number>();
  private subscriptions = new Set<string>();
  private streamRequests = new Map<string, number>();
  private historySymbols = new Map<number, string>();
  private queue: { message: Message; request: Omit<Request, "sentAt"> }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private discovered = false;
  private now: () => number;
  private cooldown = new Map<string, number>();
  private quoteBatch: { rows: [PairRow, PairRow]; stake: number; ids: number[]; quotes: (Quote | null)[]; startedAt: number } | null = null;
  private buys = new Map<number, { leg: PairLeg; resolved: boolean; trade: PairTrade; index: number }>();
  private openContracts = new Set<number>();
  private contractPairs = new Map<number, { trade: PairTrade; index: number }>();
  private pairTrades: PairTrade[] = [];
  private stats: PairStats = { ...EMPTY_PAIR_STATS };
  private marketLosses = new Map<string, number>();
  private purchaseStartedAt = 0;
  private faulted = false;

  constructor(private options: PairOptions) { this.now = options.now ?? Date.now; }
  get busy() { return this.quoteBatch !== null || this.buys.size > 0 || this.openContracts.size > 0; }
  get uncertain() { return [...this.buys.values()].some((buy) => !buy.resolved); }
  get active() { return this.running; }
  results() { return { trades: this.pairTrades.map((trade) => ({ ...trade, legs: trade.legs.map((leg) => ({ ...leg })) })), stats: { ...this.stats } }; }
  private publishResults() { const result = this.results(); this.options.onResults?.(result.trades, result.stats); }

  start() {
    if (this.busy || this.running || this.faulted) return;
    this.running = true;
    this.discovered = false;
    this.markets.clear();
    this.cooldown.clear();
    this.enqueue({ active_symbols: "brief" }, { kind: "symbols" });
    this.pulse();
    this.timer = setInterval(() => this.pulse(), 250);
  }

  stop() {
    this.running = false;
    this.queue = [];
    this.quoteBatch = null;
    this.requests.clear();
    for (const id of this.subscriptions) { try { this.options.send({ forget: id }); } catch { /* Closed socket. */ } }
    this.subscriptions.clear();
    // Keep the watchdog alive for already-sent buys and retain their correlation.
    if (!this.busy && this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  dispose() { this.stop(); if (this.timer) clearInterval(this.timer); this.timer = null; }

  private halt(message: string) {
    this.faulted = true;
    this.stop();
    this.options.onHalt(message);
  }

  private enqueue(message: Message, request: Omit<Request, "sentAt">) { this.queue.push({ message, request }); }

  pulse() {
    const now = this.now();
    if (this.uncertain && now - this.purchaseStartedAt > 15000 && !this.faulted) {
      this.halt("Paire : réponse d’achat manquante. Reconnectez le compte pour réconcilier le portefeuille ; aucun rachat automatique.");
    }
    if (this.quoteBatch && now - this.quoteBatch.startedAt > 8000) {
      this.quoteBatch.rows.forEach((row) => this.cooldown.set(row.symbol, now + 10000));
      this.quoteBatch = null;
      this.options.onStatus("Paire annulée : deux cotations valides non reçues à temps.");
    }
    for (const [id, request] of this.requests) {
      if (now - request.sentAt <= 20000) continue;
      this.requests.delete(id);
      if (request.symbol) this.markets.get(request.symbol)!.status = "Données indisponibles";
      if (request.kind === "symbols") { this.halt("Liste des indices indisponible. Relancez la connexion."); return; }
    }
    if (!this.running) return;
    const next = this.queue.shift();
    if (next) {
      const id = this.options.nextId();
      this.ownedIds.add(id);
      this.requests.set(id, { ...next.request, sentAt: now });
      if (next.request.kind === "history" && next.request.symbol) this.historySymbols.set(id, next.request.symbol);
      try { this.options.send({ ...next.message, req_id: id }); }
      catch { this.halt("Scan interrompu : connexion indisponible."); return; }
    }
    this.options.onUpdate();
  }

  rows(): PairRow[] {
    const now = this.now();
    return [...this.markets.values()].map((market) => {
      const prices = [...market.points].sort((a, b) => a[0] - b[0]).map((point) => point[1]);
      const analysis = analyzePairDigits(prices, market.pipSize);
      const fresh = now - market.updatedAt <= 5000 && market.updatedAt > 0;
      const paused = (this.cooldown.get(market.symbol) ?? 0) > now;
      const available = market.status === "Actif" && fresh && !paused;
      const underEligible = available && market.supportsUnder && analysis.underEligible;
      const overEligible = available && market.supportsOver && analysis.overEligible;
      return { ...analysis, underEligible, overEligible, eligible: underEligible || overEligible, symbol: market.symbol, name: market.name, fresh,
        status: market.status !== "Actif" ? market.status : !fresh ? "Flux périmé" : analysis.sampleSize < 500 ? "Collecte (500 min.)" : paused ? "Pause indice" : underEligible ? "Candidat Under 5" : overEligible ? "Candidat Over 4" : "Attente fréquences" };
    }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || Math.max(b.over, b.under) - Math.max(a.over, a.under) || a.symbol.localeCompare(b.symbol));
  }

  requestBestPair(stake: number, currency: string) {
    if (!this.running || this.busy || this.faulted || !this.discovered || this.queue.length || this.requests.size) return;
    if (Number.isFinite(stake) && stake >= 0.35 && pairProfitProtection(this.stats, 2 * stake)) {
      this.halt("Protection des gains : la perte d’une nouvelle paire pourrait rendre plus de 50 % du pic de bénéfice. Session arrêtée.");
      return;
    }
    const rows = selectPairMarkets(this.rows(), this.markets.size);
    if (!rows) { this.options.onStatus("Attente de deux indices distincts qualifiés : Under 5 et Over 4."); return; }
    if (!Number.isFinite(stake) || stake < 0.35 || !this.options.canBuy(2 * stake)) return;
    const ids = [this.options.nextId(), this.options.nextId()];
    this.quoteBatch = { rows, stake, ids, quotes: [null, null], startedAt: this.now() };
    ids.forEach((id) => this.ownedIds.add(id));
    this.options.onStatus(`Cotations Under 5 · ${rows[0].symbol} + Over 4 · ${rows[1].symbol} · total ${(stake * 2).toFixed(2)} ${currency}`);
    try {
      ids.forEach((id, index) => this.options.send({ proposal: 1, underlying_symbol: rows[index].symbol, contract_type: PAIR_SIDES[index].contractType, barrier: PAIR_SIDES[index].barrier, amount: stake, basis: "stake", currency, duration: 1, duration_unit: "t", req_id: id }));
    } catch { this.halt("Paire annulée : connexion perdue pendant les cotations."); }
  }

  private finishQuotes() {
    const batch = this.quoteBatch;
    if (!batch || batch.quotes.some((quote) => !quote)) return;
    this.quoteBatch = null;
    const quotes = batch.quotes as Quote[];
    const latest = this.rows();
    const current = batch.rows.map((selected) => latest.find((row) => row.symbol === selected.symbol) ?? { ...selected, eligible: false, fresh: false }) as [PairRow, PairRow];
    const evaluation = evaluatePairQuotes(current, quotes, batch.stake, this.markets.size);
    if (!this.running || quotes.some((quote) => this.now() - quote.receivedAt > 2500) || !evaluation.accepted || !this.options.canBuy(evaluation.cost)) {
      batch.rows.forEach((row) => this.cooldown.set(row.symbol, this.now() + 10000));
      this.options.onStatus(`${batch.rows[0].symbol} / ${batch.rows[1].symbol} · refus · EV estimée ${evaluation.expectedValue.toFixed(3)} / prudente ${evaluation.conservativeExpectedValue.toFixed(3)} · marge requise 2 % du coût`);
      return;
    }
    this.purchaseStartedAt = this.now();
    batch.rows.forEach((row) => this.cooldown.set(row.symbol, this.now() + 3000));
    const trade: PairTrade = { id: batch.ids[0],
      cost: evaluation.cost, expectedValue: evaluation.expectedValue, conservativeExpectedValue: evaluation.conservativeExpectedValue,
      status: "open", netProfit: null, legs: batch.rows.map((row, index) => ({ ...PAIR_SIDES[index], pair: true, symbol: row.symbol, name: row.name, stake: quotes[index].ask, duration: 1, contractId: null, profit: null, failed: false })) };
    this.pairTrades.unshift(trade);
    if (this.pairTrades.length > 50) {
      const removed = this.pairTrades.pop()!;
      removed.legs.forEach((leg) => { if (leg.contractId !== null) this.contractPairs.delete(leg.contractId); });
    }
    const requests = quotes.map((quote, index) => {
      const id = this.options.nextId();
      const leg: PairLeg = { ...PAIR_SIDES[index], pair: true, symbol: batch.rows[index].symbol, duration: 1, stake: quote.ask };
      this.buys.set(id, { leg, resolved: false, trade, index });
      this.options.onBuyRequest(id, leg);
      return { buy: quote.id, price: quote.ask, req_id: id };
    });
    this.options.onSignal();
    this.publishResults();
    this.options.onStatus(`${batch.rows[0].symbol} / ${batch.rows[1].symbol} · paire envoyée · EV prudente ${evaluation.conservativeExpectedValue.toFixed(3)}`);
    try { requests.forEach((request) => this.options.send(request)); }
    catch {
      trade.status = "incomplete";
      this.publishResults();
      this.halt("Envoi de paire incomplet : vérifiez les contrats engagés. Aucun rachat automatique.");
    }
  }

  /** True consumes scanner messages. Buys and settlements continue to the account ledger. */
  handle(message: Message): boolean {
    const id = message.req_id !== undefined ? Number(message.req_id) : this.streamRequests.get(message.subscription?.id) ?? NaN;
    const purchase = this.buys.get(id);
    if (purchase) {
      if (purchase.resolved) return false;
      if (message.error) {
        purchase.resolved = true;
        purchase.trade.status = "incomplete";
        purchase.trade.legs[purchase.index].failed = true;
        this.halt(`Paire incomplète : ${message.error.message ?? "achat refusé"}. Les contrats acceptés restent suivis.`);
      } else if (typeof message.buy?.contract_id === "number") {
        purchase.resolved = true;
        purchase.trade.legs[purchase.index].contractId = message.buy.contract_id;
        this.contractPairs.set(message.buy.contract_id, { trade: purchase.trade, index: purchase.index });
        this.openContracts.add(message.buy.contract_id);
      } else { return false; }
      if ([...this.buys.values()].every((buy) => buy.resolved)) this.buys.clear();
      this.publishResults();
      if (!this.running && !this.busy && this.timer) { clearInterval(this.timer); this.timer = null; }
      return false;
    }
    const contract = message.proposal_open_contract;
    if (contract && (contract.is_sold === true || contract.is_sold === 1 || contract.status === "won" || contract.status === "lost")) {
      const pair = this.contractPairs.get(contract.contract_id);
      if (pair && pair.trade.legs[pair.index].profit === null) {
        const profit = typeof contract.profit === "number" || (typeof contract.profit === "string" && contract.profit.trim() !== "") ? Number(contract.profit) : NaN;
        if (!Number.isFinite(profit)) {
          this.halt("Résultat net du contrat manquant : arrêt et réconciliation du portefeuille requis.");
          return false;
        }
        pair.trade.legs[pair.index].profit = profit;
        // A losing contract pauses only its own instrument, not its partner.
        const symbol = pair.trade.legs[pair.index].symbol;
        const losses = profit < -1e-8 ? (this.marketLosses.get(symbol) ?? 0) + 1 : 0;
        this.marketLosses.set(symbol, losses >= 2 ? 0 : losses);
        if (losses >= 2) this.cooldown.set(symbol, this.now() + 60000);
        if (pair.trade.legs.every((leg) => leg.profit !== null) && pair.trade.status === "open") {
          const net = pair.trade.legs.reduce((sum, leg) => sum + leg.profit!, 0);
          pair.trade.status = "settled";
          pair.trade.netProfit = net;
          this.stats.completed += 1;
          this.stats.netProfit += net;
          this.stats.peakProfit = Math.max(this.stats.peakProfit, this.stats.netProfit);
          if (net < -1e-8) {
            this.stats.losing += 1;
            this.stats.consecutiveLosses += 1;
          } else {
            if (net > 1e-8) this.stats.profitable += 1;
            this.stats.consecutiveLosses = 0;
          }
          if (this.stats.consecutiveLosses >= 3) this.halt("Arrêt : 3 paires déficitaires consécutives. Aucune récupération automatique.");
        }
        this.publishResults();
      }
      this.openContracts.delete(contract.contract_id);
      if (!this.running && !this.busy && this.timer) { clearInterval(this.timer); this.timer = null; }
    }
    if (!this.ownedIds.has(id)) return false;
    const subscription = message.subscription?.id;
    if (typeof subscription === "string") {
      if (!this.running) { try { this.options.send({ forget: subscription }); } catch {} return true; }
      this.subscriptions.add(subscription);
      this.streamRequests.set(subscription, id);
    }
    if (!this.running) return true;
    const batch = this.quoteBatch;
    if (batch?.ids.includes(id)) {
      if (message.error) {
        this.quoteBatch = null;
        batch.rows.forEach((row) => this.cooldown.set(row.symbol, this.now() + 10000));
        this.options.onStatus(`${batch.rows[0].symbol} / ${batch.rows[1].symbol} · cotation refusée, aucun achat de la paire`);
      } else {
        const quote = message.proposal;
        if (typeof quote?.id !== "string" || !Number.isFinite(quote.ask_price) || !Number.isFinite(quote.payout)) {
          this.quoteBatch = null;
          batch.rows.forEach((row) => this.cooldown.set(row.symbol, this.now() + 10000));
        } else {
          batch.quotes[batch.ids.indexOf(id)] = { id: quote.id, ask: quote.ask_price, payout: quote.payout, receivedAt: this.now() };
          this.finishQuotes();
        }
      }
      return true;
    }
    const request = this.requests.get(id);
    if (message.error) {
      this.requests.delete(id);
      if (request?.symbol) this.markets.get(request.symbol)!.status = message.error.message ?? "Indisponible";
      if (request?.kind === "symbols") this.halt("Impossible de découvrir les indices de volatilité.");
      return true;
    }
    if (request?.kind === "symbols" && Array.isArray(message.active_symbols)) {
      this.requests.delete(id);
      this.discovered = true;
      for (const symbol of volatilitySymbols(message.active_symbols)) {
        this.markets.set(symbol.symbol, { ...symbol, points: new Map(), updatedAt: 0, supportsUnder: false, supportsOver: false, status: "Vérification des contrats" });
        this.enqueue({ contracts_for: symbol.symbol }, { kind: "contracts", symbol: symbol.symbol });
      }
      if (!this.markets.size) this.halt("Aucun indice de volatilité disponible pour ce compte.");
    }
    if (request?.kind === "contracts" && Array.isArray(message.contracts_for?.available)) {
      this.requests.delete(id);
      const market = this.markets.get(request.symbol!)!;
      market.supportsUnder = supportsPairLeg(message.contracts_for.available, "DIGITUNDER");
      market.supportsOver = supportsPairLeg(message.contracts_for.available, "DIGITOVER");
      const supported = market.supportsUnder || market.supportsOver;
      market.status = supported ? "Collecte" : "Contrats 1 tick indisponibles";
      if (supported) this.enqueue({ ticks_history: market.symbol, count: 1000, end: "latest", style: "ticks", subscribe: 1 }, { kind: "history", symbol: market.symbol });
    }
    const historySymbol = this.historySymbols.get(id);
    const market = historySymbol ? this.markets.get(historySymbol) : undefined;
    if (market) {
      const history = message.history;
      if (Array.isArray(history?.prices) && Array.isArray(history.times) && history.prices.length === history.times.length) {
        const precision = message.pip_size ?? history.pip_size;
        if (Number.isInteger(precision) && precision >= 0 && precision <= 12) market.pipSize = precision;
        history.prices.forEach((price: unknown, index: number) => this.addPoint(market, Number(history.times[index]), Number(price)));
        this.requests.delete(id);
        market.status = "Actif";
      }
      const tick = message.tick;
      if (tick && (tick.symbol === market.symbol || tick.underlying_symbol === market.symbol)) {
        const precision = Number(tick.pip_size);
        if (Number.isInteger(precision) && precision >= 0 && precision <= 12) market.pipSize = precision;
        this.addPoint(market, Number(tick.epoch), Number(tick.quote));
      }
    }
    this.options.onUpdate();
    return true;
  }

  private addPoint(market: PairMarket, epoch: number, price: number) {
    if (!Number.isFinite(epoch) || !Number.isFinite(price) || Math.abs(price) >= 1e21) return;
    market.points.set(epoch, price);
    market.points = new Map([...market.points].sort((a, b) => a[0] - b[0]).slice(-1000));
    const latest = [...market.points.keys()].at(-1)! * 1000;
    // Epoch freshness prevents delayed history and repeated old ticks refreshing a market.
    market.updatedAt = latest <= this.now() + 2000 ? Math.min(latest, this.now()) : 0;
  }
}
