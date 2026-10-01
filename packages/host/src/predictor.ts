import type { ICompiledLattice, ILattice } from "@khoralabs/tkn";

/** Canonical online/offline prediction top-k (matches timeline graph slots). */
export const PREDICTION_TOP_K = 8;

/** Rolling window for learning-curve first/last deltas (matches timeline UI). */
export const PREDICTION_WINDOW = 32;

/** Unigram pool size for unseen/rare tip coverage. */
export const UNIGRAM_POOL = 64;

/** Trigram context prior strength for adaptive interpolation. */
export const TRIGRAM_PRIOR = 5;

export type ScorerProvenance = "tip" | "atomic" | "context" | "unigram";

export type RankedNext = {
  pattern: string;
  /** First source atom of the pattern (evaluation projection). */
  symbol: string;
  weight: number;
  prob: number;
  source: ScorerProvenance;
};

export type PredictionOutcome = {
  actualSymbol: string;
  covered: boolean;
  /** 1-based rank among projected symbols; null = miss. */
  rank: number | null;
  hit1: boolean;
  hitK: boolean;
  reciprocalRank: number;
  /** Soft diagnostic only — pattern equals or starts with actual symbol. */
  softPrefixHit: boolean;
};

export type SymbolProjection = {
  symbol: string;
  prob: number;
  patterns: RankedNext[];
};

/**
 * Per-run decoded tip context for second-order backoff.
 * Counts are updated after scoring, then used for the next forecast.
 */
export class DecodedContext {
  private previousTip: string | null = null;
  private currentTip: string | null = null;
  /** `${prev}\0${curr}` → `${to}` → count */
  private readonly trigrams = new Map<string, Map<string, number>>();
  /** `${prev}\0${curr}` → total */
  private readonly totals = new Map<string, number>();

  get tips(): { previous: string | null; current: string | null } {
    return { previous: this.previousTip, current: this.currentTip };
  }

  contextKey(): string | null {
    if (this.previousTip === null || this.currentTip === null) return null;
    return `${this.previousTip}\0${this.currentTip}`;
  }

  contextCount(key: string | null = this.contextKey()): number {
    if (!key) return 0;
    return this.totals.get(key) ?? 0;
  }

  successors(key: string | null = this.contextKey()): { to: string; count: number }[] {
    if (!key) return [];
    const map = this.trigrams.get(key);
    if (!map) return [];
    return [...map.entries()].map(([to, count]) => ({ to, count }));
  }

  /** Observe a completed decode tip after the current symbol has been scored. */
  observeTip(tip: string | null | undefined): void {
    if (!tip) {
      this.previousTip = this.currentTip;
      this.currentTip = null;
      return;
    }
    if (this.previousTip !== null && this.currentTip !== null) {
      const key = `${this.previousTip}\0${this.currentTip}`;
      let map = this.trigrams.get(key);
      if (!map) {
        map = new Map();
        this.trigrams.set(key, map);
      }
      map.set(tip, (map.get(tip) ?? 0) + 1);
      this.totals.set(key, (this.totals.get(key) ?? 0) + 1);
    }
    this.previousTip = this.currentTip;
    this.currentTip = tip;
  }

  reset(): void {
    this.previousTip = null;
    this.currentTip = null;
    this.trigrams.clear();
    this.totals.clear();
  }
}

function firstAtom(compiled: ICompiledLattice, pattern: string): string {
  const entry = compiled.terminals.find((t) => t.pattern === pattern);
  const atom = entry?.atoms[0];
  return atom && atom.length > 0 ? atom : pattern;
}

function patternFirstAtoms(compiled: ICompiledLattice): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of compiled.terminals) {
    const atom = t.atoms[0];
    map.set(t.pattern, atom && atom.length > 0 ? atom : t.pattern);
  }
  return map;
}

const SOURCE_RANK = { tip: 0, atomic: 1, context: 2, unigram: 3 } as const;

function addCandidate(
  pool: Map<string, { weight: number; source: ScorerProvenance }>,
  pattern: string,
  weight: number,
  source: ScorerProvenance,
): void {
  const existing = pool.get(pattern);
  if (!existing) {
    pool.set(pattern, { weight, source });
    return;
  }
  pool.set(pattern, {
    weight: Math.max(existing.weight, weight),
    source: SOURCE_RANK[source] < SOURCE_RANK[existing.source] ? source : existing.source,
  });
}

/**
 * Rank next patterns with the same add-k LM as decode, plus atomic tip backoff
 * and a per-run decoded trigram prior.
 */
export function predictNext(
  lattice: ILattice,
  compiled: ICompiledLattice,
  options: {
    decodedTip: string | null;
    latestSymbol: string | null;
    context: DecodedContext;
    topK?: number;
  },
): RankedNext[] {
  const topK = options.topK ?? PREDICTION_TOP_K;
  const tip = options.decodedTip;
  const symbol = options.latestSymbol;
  const tipEdges = tip ? lattice.getNext(tip) : [];
  const atomicEdges = symbol && symbol !== tip ? lattice.getNext(symbol) : [];
  const lmSource =
    tip && tipEdges.length > 0 ? tip : symbol && atomicEdges.length > 0 ? symbol : null;

  const pool = new Map<string, { weight: number; source: ScorerProvenance }>();
  for (const e of tipEdges) addCandidate(pool, e.to, e.weight, "tip");
  for (const e of atomicEdges) addCandidate(pool, e.to, e.weight, "atomic");

  const ctxKey = options.context.contextKey();
  const ctxSuccessors = options.context.successors(ctxKey);
  for (const s of ctxSuccessors) addCandidate(pool, s.to, s.count, "context");

  const atoms = patternFirstAtoms(compiled);
  const unigram = [...compiled.patterns]
    .map((p) => ({ pattern: p, log: compiled.emissionLogProb(p) }))
    .sort((a, b) => b.log - a.log || a.pattern.localeCompare(b.pattern))
    .slice(0, UNIGRAM_POOL);
  for (const u of unigram) addCandidate(pool, u.pattern, 0, "unigram");

  if (pool.size === 0) return [];

  const ctxTotal = options.context.contextCount(ctxKey);
  const lambda3 = ctxTotal / (ctxTotal + TRIGRAM_PRIOR);
  const ctxMap = new Map(ctxSuccessors.map((s) => [s.to, s.count]));
  const vocabK = Math.max(1, compiled.patterns.length);

  const scored: Array<RankedNext & { mix: number }> = [];
  for (const [pattern, meta] of pool) {
    const p1 = Math.exp(compiled.emissionLogProb(pattern));
    const p2 = lmSource === null ? p1 : Math.exp(compiled.transitionLogProb(lmSource, pattern));
    let p3 = 0;
    if (ctxTotal > 0) {
      const count = ctxMap.get(pattern) ?? 0;
      p3 = (count + 0.1) / (ctxTotal + 0.1 * vocabK);
    }
    const mix = lambda3 * p3 + (1 - lambda3) * (0.9 * p2 + 0.1 * p1);
    scored.push({
      pattern,
      symbol: atoms.get(pattern) ?? firstAtom(compiled, pattern),
      weight: meta.weight,
      prob: 0,
      source: meta.source,
      mix,
    });
  }

  scored.sort((a, b) => b.mix - a.mix || a.pattern.localeCompare(b.pattern));
  const top = scored.slice(0, topK);
  const total = top.reduce((s, r) => s + r.mix, 0);
  return top.map(({ mix, ...rest }) => ({
    ...rest,
    prob: total > 0 ? mix / total : top.length > 0 ? 1 / top.length : 0,
  }));
}

/** Aggregate pattern rankings by projected first source atom (hard metric space). */
export function projectToSymbols(ranked: RankedNext[]): SymbolProjection[] {
  const bySymbol = new Map<string, SymbolProjection>();
  for (const r of ranked) {
    const existing = bySymbol.get(r.symbol);
    if (!existing) {
      bySymbol.set(r.symbol, { symbol: r.symbol, prob: r.prob, patterns: [r] });
    } else {
      existing.prob += r.prob;
      existing.patterns.push(r);
    }
  }
  return [...bySymbol.values()].sort((a, b) => b.prob - a.prob || a.symbol.localeCompare(b.symbol));
}

/** Score a prior forecast against an arriving source symbol (prequential). */
export function scorePrediction(
  ranked: RankedNext[],
  actualSymbol: string,
  hitK = PREDICTION_TOP_K,
): PredictionOutcome {
  const projected = projectToSymbols(ranked);
  const covered = projected.length > 0;
  const idx = projected.findIndex((p) => p.symbol === actualSymbol);
  const rank = idx >= 0 ? idx + 1 : null;
  const softPrefixHit = ranked.some(
    (r) => r.pattern === actualSymbol || r.pattern.startsWith(actualSymbol),
  );
  return {
    actualSymbol,
    covered,
    rank,
    hit1: rank === 1,
    hitK: rank !== null && rank <= hitK,
    reciprocalRank: rank === null ? 0 : 1 / rank,
    softPrefixHit,
  };
}

export type AggregatePredictionMetrics = {
  trials: number;
  hitAt1: number;
  hitAtK: number;
  mrr: number;
  coverage: number;
  softPrefixHitRate: number;
};

export function aggregateOutcomes(
  outcomes: readonly PredictionOutcome[],
): AggregatePredictionMetrics {
  const trials = outcomes.length;
  if (trials === 0) {
    return { trials: 0, hitAt1: 0, hitAtK: 0, mrr: 0, coverage: 0, softPrefixHitRate: 0 };
  }
  return {
    trials,
    hitAt1: outcomes.filter((o) => o.hit1).length / trials,
    hitAtK: outcomes.filter((o) => o.hitK).length / trials,
    mrr: outcomes.reduce((s, o) => s + o.reciprocalRank, 0) / trials,
    coverage: outcomes.filter((o) => o.covered).length / trials,
    softPrefixHitRate: outcomes.filter((o) => o.softPrefixHit).length / trials,
  };
}

/** First/last window aggregates for learning-curve deltas. */
export function windowMetrics(
  outcomes: readonly PredictionOutcome[],
  windowSize: number,
): { first: AggregatePredictionMetrics; last: AggregatePredictionMetrics } {
  const w = Math.max(1, windowSize);
  return {
    first: aggregateOutcomes(outcomes.slice(0, w)),
    last: aggregateOutcomes(outcomes.slice(-w)),
  };
}
