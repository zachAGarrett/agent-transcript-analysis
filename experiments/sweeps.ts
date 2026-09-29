import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { LatticeDecodeOptions } from "@khoralabs/tkn";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { type AggregateDecodeMetrics, buildDecodeSummary, traceFromDecode } from "./metrics";
import { ExperimentPipeline } from "./pipeline";
import { producerFrom, type Sequence } from "./producers";
import { sessionIdOf, splitBySession } from "./split";

export type SweepConfig = {
  name: string;
  decodeOptions?: LatticeDecodeOptions;
  smoothing?: number;
};

export type SweepResult = {
  name: string;
  metrics: AggregateDecodeMetrics;
  decodeOptions?: LatticeDecodeOptions;
  smoothing?: number;
};

const DEFAULT_DECODER_SWEEPS: SweepConfig[] = [
  { name: "viterbi", decodeOptions: { mode: "viterbi" } },
  { name: "beam-1", decodeOptions: { mode: "beam", beamWidth: 1 } },
  { name: "beam-4", decodeOptions: { mode: "beam", beamWidth: 4 } },
  { name: "beam-16", decodeOptions: { mode: "beam", beamWidth: 16 } },
  { name: "beam-64", decodeOptions: { mode: "beam", beamWidth: 64 } },
];

const DEFAULT_LM_SWEEPS: SweepConfig[] = [
  { name: "bigram-k0.01", decodeOptions: { useBigram: true }, smoothing: 0.01 },
  { name: "bigram-k0.1", decodeOptions: { useBigram: true }, smoothing: 0.1 },
  { name: "bigram-k1", decodeOptions: { useBigram: true }, smoothing: 1 },
  { name: "unigram-k0.1", decodeOptions: { useBigram: false }, smoothing: 0.1 },
];

export { DEFAULT_DECODER_SWEEPS, DEFAULT_LM_SWEEPS };

/** Decode holdout against an already-trained pipeline (shared lattice). */
export function evaluateHoldout(
  pipeline: ExperimentPipeline,
  holdout: Sequence[],
  config: SweepConfig,
): SweepResult {
  const compiled = pipeline.compile(
    config.smoothing !== undefined ? { smoothing: config.smoothing } : undefined,
  );
  const traces = [];
  for (const sequence of holdout) {
    const t0 = performance.now();
    const result = pipeline.decode(sequence, config.decodeOptions, compiled);
    traces.push(traceFromDecode(sequence, sessionIdOf(sequence), result, performance.now() - t0));
  }
  const metrics = buildDecodeSummary(traces, compiled.patternCount).metrics;
  return {
    name: config.name,
    metrics,
    decodeOptions: config.decodeOptions,
    smoothing: config.smoothing,
  };
}

export type SweepJobOptions = {
  sequences: Sequence[];
  holdoutPct: number;
  seed: number;
  configs: SweepConfig[];
  outDir: string;
};

export async function runSweeps(options: SweepJobOptions): Promise<SweepResult[]> {
  const split = splitBySession(options.sequences, {
    holdoutPct: options.holdoutPct,
    seed: options.seed,
  });
  await mkdir(options.outDir, { recursive: true });
  const dbPath = join(options.outDir, "lattice.db");
  const lattice = new Lattice({ filename: dbPath });
  const results: SweepResult[] = [];
  try {
    const pipeline = new ExperimentPipeline(lattice);
    for await (const _ of pipeline.feed(producerFrom(split.train))) {
      // ingest
    }
    lattice.getTopTokens(1);
    for (const config of options.configs) {
      const result = evaluateHoldout(pipeline, split.holdout, config);
      results.push(result);
      console.log(
        `sweep ${config.name}: complete=${result.metrics.completeRate.toFixed(3)} ` +
          `multi=${result.metrics.multiSymbolCoverage.toFixed(3)} ` +
          `span=${result.metrics.meanSpan.toFixed(3)} ` +
          `score=${result.metrics.meanScore.toFixed(3)} ` +
          `ms=${result.metrics.meanLatencyMs.toFixed(2)}`,
      );
    }
  } finally {
    lattice.close();
  }
  await writeFile(join(options.outDir, "sweeps.json"), `${JSON.stringify(results, null, 2)}\n`);
  return results;
}

/** MDL-style components: held-out encoding cost + vocabulary cost (not a single score). */
export function mdlComponents(metrics: AggregateDecodeMetrics): {
  heldOutEncodingCost: number;
  vocabularyCost: number;
} {
  return {
    heldOutEncodingCost: -metrics.meanScore * metrics.sequenceCount,
    vocabularyCost: Math.log2(Math.max(1, metrics.vocabularySize)),
  };
}
