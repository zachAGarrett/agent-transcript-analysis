import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { scoreLatticeDb } from "@/experiments/score-lattice";
import type { Encoder } from "@/fixtures/encoders";
import { RUNS_DIRNAME } from "@/fixtures/prepare";
import { serializeLoopEvent } from "./event-serialize";
import { DEFAULT_COMMIT_BATCH_SIZE } from "./learner";
import { OnlineLoop } from "./loop";
import {
  aggregateOutcomes,
  PREDICTION_TOP_K,
  PREDICTION_WINDOW,
  type PredictionOutcome,
  TRIGRAM_PRIOR,
  UNIGRAM_POOL,
  windowMetrics,
} from "./predictor";

export const RUNTIME_DIRNAME = "runtime";

export { PREDICTION_WINDOW };

function jobId(now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:.]/g, "-");
}

export type PredictionSummary = {
  methodology: "prequential-test-then-train";
  target: "next-source-symbol";
  topK: number;
  window: number;
  contextOrder: 2;
  trigramPrior: number;
  unigramPool: number;
  trials: number;
  hitAt1: number;
  hitAtK: number;
  mrr: number;
  coverage: number;
  softPrefixHitRate: number;
  firstWindow: {
    hitAt1: number;
    hitAtK: number;
    mrr: number;
    coverage: number;
  };
  lastWindow: {
    hitAt1: number;
    hitAtK: number;
    mrr: number;
    coverage: number;
  };
  delta: {
    hitAt1: number;
    hitAtK: number;
    mrr: number;
    coverage: number;
  };
};

export type RuntimeReplayReport = {
  version: 1;
  kind: "runtime-replay";
  job: {
    createdAt: string;
    fixtureVersion: string;
    transcriptId: string;
    concurrency: number;
    recompileEvery: number;
    commitBatchSize: number;
    symbolCount: number;
    artifacts: {
      latticeDb: string;
      eventsJsonl: string;
    };
  };
  prediction?: PredictionSummary;
};

export type ReplayMessagesOptions<TMessage> = {
  messages: AsyncIterable<TMessage>;
  encoder: Encoder<TMessage>;
  /** Absolute job output directory (created if missing). */
  outDir: string;
  /** Relative paths from repo root for report artifacts. */
  artifactRel: {
    latticeDb: string;
    eventsJsonl: string;
  };
  fixtureVersion: string;
  transcriptId: string;
  concurrency?: number;
  recompileEvery?: number;
  /** Segment flush threshold for OnlineLearner (default 10). */
  commitBatchSize?: number;
  createdAt?: Date;
  root?: string;
};

export type ReplayResult = {
  dir: string;
  id: string;
  symbolCount: number;
  report: RuntimeReplayReport;
};

function summarizePredictions(outcomes: PredictionOutcome[]): PredictionSummary {
  const overall = aggregateOutcomes(outcomes);
  const { first, last } = windowMetrics(outcomes, PREDICTION_WINDOW);
  return {
    methodology: "prequential-test-then-train",
    target: "next-source-symbol",
    topK: PREDICTION_TOP_K,
    window: PREDICTION_WINDOW,
    contextOrder: 2,
    trigramPrior: TRIGRAM_PRIOR,
    unigramPool: UNIGRAM_POOL,
    trials: overall.trials,
    hitAt1: overall.hitAt1,
    hitAtK: overall.hitAtK,
    mrr: overall.mrr,
    coverage: overall.coverage,
    softPrefixHitRate: overall.softPrefixHitRate,
    firstWindow: {
      hitAt1: first.hitAt1,
      hitAtK: first.hitAtK,
      mrr: first.mrr,
      coverage: first.coverage,
    },
    lastWindow: {
      hitAt1: last.hitAt1,
      hitAtK: last.hitAtK,
      mrr: last.mrr,
      coverage: last.coverage,
    },
    delta: {
      hitAt1: last.hitAt1 - first.hitAt1,
      hitAtK: last.hitAtK - first.hitAtK,
      mrr: last.mrr - first.mrr,
      coverage: last.coverage - first.coverage,
    },
  };
}

/**
 * Run OnlineLoop over an already-loaded message stream and write review artifacts.
 */
export async function replayMessages<TMessage>(
  options: ReplayMessagesOptions<TMessage>,
): Promise<ReplayResult> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const recompileEvery = Math.max(1, options.recompileEvery ?? 1);
  const commitBatchSize = Math.max(1, options.commitBatchSize ?? DEFAULT_COMMIT_BATCH_SIZE);
  const createdAt = options.createdAt ?? new Date();
  const id = jobId(createdAt);
  const outDir = options.outDir;

  await mkdir(outDir, { recursive: true });
  const latticePath = join(outDir, "lattice.db");
  const eventsPath = join(outDir, "events.jsonl");

  const eventsFile = Bun.file(eventsPath);
  const writer = eventsFile.writer();
  let symbolCount = 0;
  const outcomes: PredictionOutcome[] = [];

  const lattice = new Lattice({ filename: latticePath });
  try {
    const loop = new OnlineLoop(options.encoder, lattice, { commitBatchSize });
    for await (const event of loop.run(options.messages, { concurrency, recompileEvery })) {
      writer.write(`${serializeLoopEvent(event)}\n`);
      if (event.kind === "decoded" && event.outcome) outcomes.push(event.outcome);
      if (event.kind === "sessionEnded") symbolCount = event.symbolCount;
    }
  } finally {
    await writer.end();
    lattice.close();
  }

  scoreLatticeDb(latticePath);

  const report: RuntimeReplayReport = {
    version: 1,
    kind: "runtime-replay",
    job: {
      createdAt: createdAt.toISOString(),
      fixtureVersion: options.fixtureVersion,
      transcriptId: options.transcriptId,
      concurrency,
      recompileEvery,
      commitBatchSize,
      symbolCount,
      artifacts: {
        latticeDb: options.artifactRel.latticeDb,
        eventsJsonl: options.artifactRel.eventsJsonl,
      },
    },
    prediction: summarizePredictions(outcomes),
  };
  await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  return { dir: outDir, id, symbolCount, report };
}

type VersionModule = {
  encoder: Encoder<unknown>;
  listParentTranscripts: () => Array<{ id: string; path: string }>;
  messagesFromTranscript: (path: string) => AsyncGenerator<unknown>;
};

async function loadVersion(root: string, version: string): Promise<VersionModule> {
  const base = join(root, "fixtures", version);
  const encoderMod = await import(`${base}/encoder.ts`);
  const loadMod = await import(`${base}/load.ts`);
  return {
    encoder: encoderMod.encoder as Encoder<unknown>,
    listParentTranscripts: loadMod.listParentTranscripts,
    messagesFromTranscript: loadMod.messagesFromTranscript,
  };
}

export type ReplayTranscriptOptions = {
  transcriptId: string;
  version: string;
  root?: string;
  concurrency?: number;
  recompileEvery?: number;
  commitBatchSize?: number;
};

/**
 * Load one parent transcript and replay it through the online session-span loop.
 */
export async function replayTranscript(options: ReplayTranscriptOptions): Promise<ReplayResult> {
  const root = options.root ?? join(import.meta.dir, "..");
  const version = options.version;
  const mod = await loadVersion(root, version);

  const transcript = mod.listParentTranscripts().find((t) => t.id === options.transcriptId);
  if (!transcript) {
    throw new Error(`Transcript not found: ${options.transcriptId}`);
  }

  const createdAt = new Date();
  const id = jobId(createdAt);
  const dirRel = `${RUNTIME_DIRNAME}/${version}/${RUNS_DIRNAME}/${id}`;
  const dirAbs = join(root, dirRel);

  return replayMessages({
    messages: mod.messagesFromTranscript(transcript.path),
    encoder: mod.encoder,
    outDir: dirAbs,
    artifactRel: {
      latticeDb: `${dirRel}/lattice.db`,
      eventsJsonl: `${dirRel}/events.jsonl`,
    },
    fixtureVersion: version,
    transcriptId: options.transcriptId,
    concurrency: options.concurrency,
    recompileEvery: options.recompileEvery,
    commitBatchSize: options.commitBatchSize,
    createdAt,
    root,
  });
}

/** Absolute path to runtime/<version>/runs. */
export function runtimeRunsDir(root: string, version: string): string {
  return join(root, RUNTIME_DIRNAME, version, RUNS_DIRNAME);
}
