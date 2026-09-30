import type { ILattice } from "@khoralabs/tkn";
import {
  aggregateOutcomes,
  DecodedContext,
  PREDICTION_TOP_K,
  type PredictionOutcome,
  predictNext,
  type RankedNext,
  scorePrediction,
} from "@/runtime/predictor";
import type { ExperimentPipeline } from "./pipeline";
import type { Sequence } from "./producers";

export type PrefixPrediction = {
  sequenceId: string;
  prefixLen: number;
  lastToken: string;
  actualNextSymbol: string | null;
  ranked: RankedNext[];
  /** Strict 1-based rank on projected source symbols; null = miss. */
  hitAt: number | null;
  mrr: number;
  covered: boolean;
  softPrefixHit: boolean;
};

export type PrefixMetrics = {
  prefixes: number;
  hitAt1: number;
  hitAt5: number;
  hitAt10: number;
  mrr: number;
  coverage: number;
  softPrefixHitRate: number;
};

/**
 * After decoding a held-out prefix, rank next patterns with the shared LM predictor.
 * Hard metrics use exact next-source-symbol rank after pattern→first-atom projection.
 * Soft prefix matches are reported separately and do not affect hit@k / MRR.
 */
export function predictNextPatterns(
  lattice: ILattice,
  pipeline: ExperimentPipeline,
  sequences: Sequence[],
  options?: { maxPrefix?: number; topK?: number },
): { predictions: PrefixPrediction[]; metrics: PrefixMetrics } {
  const topK = options?.topK ?? Math.max(10, PREDICTION_TOP_K);
  const maxPrefix = options?.maxPrefix ?? 32;
  const compiled = pipeline.compile();
  const predictions: PrefixPrediction[] = [];
  const outcomes: PredictionOutcome[] = [];

  for (const sequence of sequences) {
    const context = new DecodedContext();
    const maxLen = Math.min(maxPrefix, sequence.symbols.length - 1);
    for (let len = 1; len <= maxLen; len++) {
      const prefix: Sequence = {
        id: `${sequence.id}@${len}`,
        symbols: sequence.symbols.slice(0, len),
      };
      const decoded = pipeline.decode(prefix, undefined, compiled);
      if (!decoded.complete || decoded.tokens.length === 0) continue;
      const lastToken = decoded.tokens.at(-1);
      if (!lastToken) continue;
      const latestSymbol = prefix.symbols.at(-1) ?? null;
      const ranked = predictNext(lattice, compiled, {
        decodedTip: lastToken,
        latestSymbol,
        context,
        topK,
      });
      context.observeTip(lastToken);

      const actualNextSymbol = sequence.symbols[len] ?? null;
      if (!actualNextSymbol) continue;
      const outcome = scorePrediction(ranked, actualNextSymbol, topK);
      outcomes.push(outcome);
      predictions.push({
        sequenceId: sequence.id,
        prefixLen: len,
        lastToken,
        actualNextSymbol,
        ranked,
        hitAt: outcome.rank,
        mrr: outcome.reciprocalRank,
        covered: outcome.covered,
        softPrefixHit: outcome.softPrefixHit,
      });
    }
  }

  const prefixes = outcomes.length;
  const hard = aggregateOutcomes(outcomes);
  const hits = (k: number) =>
    prefixes === 0 ? 0 : outcomes.filter((o) => o.rank !== null && o.rank <= k).length / prefixes;

  return {
    predictions,
    metrics: {
      prefixes,
      hitAt1: hits(1),
      hitAt5: hits(5),
      hitAt10: hits(10),
      mrr: hard.mrr,
      coverage: hard.coverage,
      softPrefixHitRate: hard.softPrefixHitRate,
    },
  };
}
