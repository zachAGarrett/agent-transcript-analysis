/**
 * Browser-safe timeline types and pure series helpers.
 * Keep Node fs / @workstream/host barrels out of this module — HTML entry imports it.
 */

/** Matches @workstream/host PREDICTION_TOP_K / transition-graph next slots. */
export const TIMELINE_HIT_K = 8;

/** Matches @workstream/host PREDICTION_WINDOW. */
export const TIMELINE_ACCURACY_WINDOW = 32;

export type ScorerProvenance = "tip" | "atomic" | "context" | "unigram";

export type TimelineStep = {
  token: string;
  start: number;
  end: number;
  emissionScore: number;
  transitionScore: number;
};

export type TimelineNext = {
  pattern: string;
  symbol?: string;
  weight: number;
  prob: number;
  source?: ScorerProvenance;
};

/** Subset of host PredictionOutcome used by accuracySeries. */
export type TimelineOutcome = {
  actualSymbol: string;
  covered: boolean;
  rank: number | null;
  hit1: boolean;
  hitK: boolean;
  reciprocalRank: number;
  softPrefixHit: boolean;
};

export type TimelineFrame = {
  index: number;
  symbol: string;
  symbolCount: number;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  /** Full decoded step count; may equal steps.length for legacy rows. */
  decodedStepCount: number;
  /** True when decodedStepCount was inferred from the truncated steps tail. */
  decodedStepCountApproximate: boolean;
  score: number;
  complete: boolean;
  steps: TimelineStep[];
  next: TimelineNext[];
  /** Outcome of the previous forecast vs this frame's source symbol. */
  outcome?: TimelineOutcome;
};

export type TimelineAccuracyPoint = {
  i: number;
  index: number;
  hit1: number;
  hitK: number;
  mrr: number;
  coverage: number;
  window: number;
};

/**
 * Rolling hit@1 / hit@k / MRR / coverage from persisted prequential outcomes.
 * No frame lookahead — outcomes already score the prior forecast against this symbol.
 */
export function accuracySeries(
  frames: TimelineFrame[],
  windowSize = TIMELINE_ACCURACY_WINDOW,
): TimelineAccuracyPoint[] {
  const window = Math.max(1, windowSize);
  const outcomes: TimelineOutcome[] = [];
  const out: TimelineAccuracyPoint[] = [];
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (frame?.outcome) outcomes.push(frame.outcome);
    const slice = outcomes.slice(-window);
    const n = slice.length;
    out.push({
      i,
      index: frame?.index ?? i,
      hit1: n > 0 ? slice.filter((o) => o.hit1).length / n : 0,
      hitK: n > 0 ? slice.filter((o) => o.hitK).length / n : 0,
      mrr: n > 0 ? slice.reduce((s, o) => s + o.reciprocalRank, 0) / n : 0,
      coverage: n > 0 ? slice.filter((o) => o.covered).length / n : 0,
      window: n,
    });
  }
  return out;
}

export type TimelineCompressionPoint = {
  i: number;
  index: number;
  /** 1 − decodedStepCount / symbolCount */
  reduction: number;
  meanSpan: number;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  approximate: boolean;
};

/** Compression reduction over timeline position. */
export function compressionSeries(frames: TimelineFrame[]): TimelineCompressionPoint[] {
  return frames.map((f, i) => {
    const symbolCount = Math.max(0, f.symbolCount);
    const steps = Math.max(0, f.decodedStepCount);
    const reduction = symbolCount === 0 ? 0 : 1 - steps / symbolCount;
    return {
      i,
      index: f.index,
      reduction: Math.max(0, Math.min(1, reduction)),
      meanSpan: steps === 0 ? 0 : symbolCount / steps,
      multiSymbolCoverage: f.multiSymbolCoverage,
      atomicFallbackRate: f.atomicFallbackRate,
      approximate: f.decodedStepCountApproximate,
    };
  });
}
