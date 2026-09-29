import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import {
  type AggregateDecodeMetrics,
  buildDecodeSummary,
  traceFromDecode,
} from "@/experiments/metrics";
import { ExperimentPipeline } from "@/experiments/pipeline";
import { producerFrom, type Sequence } from "@/experiments/producers";
import {
  type RunReport,
  writeDecodeSummary,
  writeDecodesJsonl,
  writeReport,
} from "@/experiments/report";
import { sessionIdOf, splitBySession } from "@/experiments/split";
import type { ExperimentDefinition, RunJobOptions, RunJobResult } from "@/experiments/types";
import { RUNS_DIRNAME } from "@/fixtures/prepare";

export function jobId(now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:.]/g, "-");
}

export async function loadAll(producer: {
  sequences(): AsyncGenerator<Sequence>;
}): Promise<Sequence[]> {
  const out: Sequence[] = [];
  for await (const sequence of producer.sequences()) {
    if (sequence.symbols.length > 0) out.push(sequence);
  }
  return out;
}

/**
 * Shared experiment runner: train a SQLite lattice, optionally decode held-out.
 * Artifacts: lattice.db, report.json, and when holdout is set: decodes.jsonl + decode-summary.json.
 */
export async function runJob(
  definition: ExperimentDefinition,
  options: RunJobOptions,
): Promise<RunJobResult> {
  const root = options.root ?? join(import.meta.dir, "..");
  const createdAt = new Date();
  const id = jobId(createdAt);
  const dirRel = `experiments/${definition.name}/${definition.version}/${RUNS_DIRNAME}/${id}`;
  const dirAbs = join(root, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const latticeDb = join(dirAbs, "lattice.db");

  const producer = definition.createProducer({
    paths: options.paths,
    fixtureVersion: options.fixtureVersion,
    root,
  });
  const all = await loadAll(producer);
  if (all.length === 0) {
    throw new Error("No sequences from producer");
  }

  const seed = options.seed ?? 1;
  const holdoutPct = options.holdoutPct;
  let train = all;
  let holdout: Sequence[] = [];
  let trainSessionIds: string[] | undefined;
  let holdoutSessionIds: string[] | undefined;

  if (holdoutPct !== undefined) {
    const split = splitBySession(all, { holdoutPct, seed });
    train = split.train;
    holdout = split.holdout;
    trainSessionIds = split.trainSessionIds;
    holdoutSessionIds = split.holdoutSessionIds;
  }

  console.log(
    `${definition.name}@${definition.version}: ${train.length} train` +
      (holdout.length > 0 ? `, ${holdout.length} holdout` : "") +
      ` sequences`,
  );

  const lattice = new Lattice({ filename: latticeDb });
  let metrics: AggregateDecodeMetrics | undefined;
  let decodesPath: string | undefined;
  let decodeSummaryPath: string | undefined;

  try {
    const pipeline = new ExperimentPipeline(lattice);
    for await (const _ of pipeline.feed(producerFrom(train))) {
      // ingest
    }
    lattice.getTopTokens(1);

    if (holdout.length > 0 && !options.skipDecode) {
      const compileOpts =
        options.smoothing !== undefined ? { smoothing: options.smoothing } : undefined;
      const compiled = pipeline.compile(compileOpts);
      const traces = [];
      for (const sequence of holdout) {
        const t0 = performance.now();
        const result = pipeline.decode(sequence, options.decodeOptions, compiled);
        const latencyMs = performance.now() - t0;
        traces.push(traceFromDecode(sequence, sessionIdOf(sequence), result, latencyMs));
      }
      metrics = buildDecodeSummary(traces, compiled.patternCount).metrics;
      const summary = buildDecodeSummary(traces, compiled.patternCount);
      decodesPath = await writeDecodesJsonl(dirAbs, traces);
      decodeSummaryPath = await writeDecodeSummary(dirAbs, summary);
      console.log(
        `holdout metrics: complete=${metrics.completeRate.toFixed(3)} ` +
          `multi=${metrics.multiSymbolCoverage.toFixed(3)} ` +
          `atomic=${metrics.atomicFallbackRate.toFixed(3)} ` +
          `meanSpan=${metrics.meanSpan.toFixed(3)}`,
      );
    }

    lattice.invalidateCompiled();
    console.log(`latticeDb=${dirRel}/lattice.db`);

    const report: RunReport = {
      version: 1,
      job: {
        experiment: definition.name,
        experimentVersion: definition.version,
        fixtureVersion: options.fixtureVersion,
        fixtureJobId: options.fixtureJobId,
        createdAt: createdAt.toISOString(),
        seed: holdoutPct !== undefined ? seed : undefined,
        holdoutPct,
        trainCount: train.length,
        heldOutCount: holdout.length,
        trainSessionIds,
        holdoutSessionIds,
        paths: options.paths.map((p) => p.replace(`${root}/`, "")),
        decodeOptions: options.decodeOptions as Record<string, unknown> | undefined,
        smoothing: options.smoothing,
        sequenceBoundary: "endSequence",
        artifacts: {
          latticeDb: `${dirRel}/lattice.db`,
          decodesJsonl: decodesPath ? `${dirRel}/decodes.jsonl` : null,
          decodeSummaryJson: decodeSummaryPath ? `${dirRel}/decode-summary.json` : null,
        },
      },
      metrics,
    };
    const reportPath = await writeReport(dirAbs, report);

    return {
      dir: dirRel,
      latticeDb: `${dirRel}/lattice.db`,
      sequenceCount: all.length,
      trainCount: train.length,
      heldOutCount: holdout.length,
      metrics,
      reportPath,
      decodesPath,
      decodeSummaryPath,
    };
  } finally {
    lattice.close();
  }
}
