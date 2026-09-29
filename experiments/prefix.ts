import type { ILattice } from "@khoralabs/tkn";
import type { ExperimentPipeline } from "./pipeline";
import type { Sequence } from "./producers";

export type PrefixPrediction = {
  sequenceId: string;
  prefixLen: number;
  lastToken: string;
  actualNextSymbol: string | null;
  ranked: { pattern: string; weight: number; prob: number }[];
  hitAt: number | null;
  mrr: number;
};

export type PrefixMetrics = {
  prefixes: number;
  hitAt1: number;
  hitAt5: number;
  hitAt10: number;
  mrr: number;
  coverage: number;
};

/**
 * After decoding a held-out prefix, rank next patterns from lattice.getNext(lastToken).
 * Evaluates whether the next *source symbol* appears as a length-1 candidate among top-k,
 * or whether any ranked pattern starts with that symbol.
 */
export function predictNextPatterns(
  lattice: ILattice,
  pipeline: ExperimentPipeline,
  sequences: Sequence[],
  options?: { maxPrefix?: number; topK?: number },
): { predictions: PrefixPrediction[]; metrics: PrefixMetrics } {
  const topK = options?.topK ?? 10;
  const maxPrefix = options?.maxPrefix ?? 32;
  const compiled = pipeline.compile();
  const predictions: PrefixPrediction[] = [];

  for (const sequence of sequences) {
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
      const next = lattice.getNext(lastToken);
      const total = next.reduce((s, e) => s + e.weight, 0);
      const ranked = [...next]
        .sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to))
        .slice(0, topK)
        .map((e) => ({
          pattern: e.to,
          weight: e.weight,
          prob: total > 0 ? e.weight / total : 0,
        }));
      const actualNextSymbol = sequence.symbols[len] ?? null;
      let hitAt: number | null = null;
      if (actualNextSymbol) {
        const idx = ranked.findIndex(
          (r) => r.pattern === actualNextSymbol || r.pattern.startsWith(actualNextSymbol),
        );
        hitAt = idx >= 0 ? idx + 1 : null;
      }
      predictions.push({
        sequenceId: sequence.id,
        prefixLen: len,
        lastToken,
        actualNextSymbol,
        ranked,
        hitAt,
        mrr: hitAt === null ? 0 : 1 / hitAt,
      });
    }
  }

  const prefixes = predictions.length;
  const hits = (k: number) =>
    prefixes === 0
      ? 0
      : predictions.filter((p) => p.hitAt !== null && p.hitAt <= k).length / prefixes;
  const coverage =
    prefixes === 0 ? 0 : predictions.filter((p) => p.ranked.length > 0).length / prefixes;
  const mrr = prefixes === 0 ? 0 : predictions.reduce((s, p) => s + p.mrr, 0) / prefixes;

  return {
    predictions,
    metrics: {
      prefixes,
      hitAt1: hits(1),
      hitAt5: hits(5),
      hitAt10: hits(10),
      mrr,
      coverage,
    },
  };
}
