import { createReadStream, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";
import type { PredictionOutcome, RankedNext, ScorerProvenance } from "@/runtime/predictor";
import { PREDICTION_TOP_K, PREDICTION_WINDOW } from "@/runtime/predictor";

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
  outcome?: PredictionOutcome;
};

/** Top-k for timeline predictive accuracy (matches transition-graph next slots). */
export const TIMELINE_HIT_K = PREDICTION_TOP_K;

/** Rolling window (prediction steps) for timeline hit-rate series. */
export const TIMELINE_ACCURACY_WINDOW = PREDICTION_WINDOW;

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
  const outcomes: PredictionOutcome[] = [];
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

const MAX_FRAMES = 20_000;
/** Cap steps kept per frame from fat legacy events.jsonl rows. */
const STEPS_TAIL = 64;

function assertSafeRunDir(root: string, runId: string): string {
  if (!/^[\w-]+$/.test(runId)) throw new Error("Invalid run ID.");
  let rootReal: string;
  let directory: string;
  try {
    rootReal = realpathSync(root);
    directory = realpathSync(join(rootReal, runId));
  } catch {
    throw new Error(`Run directory not found: ${runId}`);
  }
  if (!directory.startsWith(`${rootReal}${sep}`)) {
    throw new Error("Run escaped the configured root.");
  }
  return directory;
}

function mapStep(s: {
  token: string;
  start: number;
  end: number;
  emissionScore: number;
  transitionScore: number;
}): TimelineStep {
  return {
    token: s.token,
    start: s.start,
    end: s.end,
    emissionScore: s.emissionScore,
    transitionScore: s.transitionScore,
  };
}

function tailSteps(
  steps: Array<{
    token: string;
    start: number;
    end: number;
    emissionScore: number;
    transitionScore: number;
  }>,
): TimelineStep[] {
  const slice = steps.length > STEPS_TAIL ? steps.slice(-STEPS_TAIL) : steps;
  return slice.map(mapStep);
}

function mapNext(raw: unknown): TimelineNext[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => {
    const row = e as RankedNext & { pattern: string; weight: number; prob: number };
    return {
      pattern: String(row.pattern ?? ""),
      symbol: row.symbol !== undefined ? String(row.symbol) : undefined,
      weight: Number(row.weight ?? 0),
      prob: Number(row.prob ?? 0),
      source: row.source,
    };
  });
}

function mapOutcome(raw: unknown): PredictionOutcome | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.actualSymbol !== "string") return undefined;
  return {
    actualSymbol: o.actualSymbol,
    covered: Boolean(o.covered),
    rank: typeof o.rank === "number" ? o.rank : null,
    hit1: Boolean(o.hit1),
    hitK: Boolean(o.hitK),
    reciprocalRank: Number(o.reciprocalRank ?? 0),
    softPrefixHit: Boolean(o.softPrefixHit),
  };
}

/** Accept compact (v2) or legacy fat snapshot decoded rows. */
function frameFromRow(row: Record<string, unknown>): TimelineFrame | null {
  if (row.kind !== "decoded") return null;

  const snap = row.snapshot as
    | {
        symbols?: string[];
        result?: {
          steps?: Array<{
            token: string;
            start: number;
            end: number;
            emissionScore: number;
            transitionScore: number;
          }>;
          score?: number;
          complete?: boolean;
        };
        multiSymbolCoverage?: number;
        atomicFallbackRate?: number;
        decodedStepCount?: number;
        next?: TimelineNext[];
      }
    | undefined;

  if (snap) {
    const steps = tailSteps(snap.result?.steps ?? []);
    const decodedStepCount =
      typeof snap.decodedStepCount === "number"
        ? snap.decodedStepCount
        : (snap.result?.steps?.length ?? steps.length);
    const approximate = typeof snap.decodedStepCount !== "number";
    return {
      index: Number(row.index),
      symbol: String(row.symbol ?? ""),
      symbolCount: snap.symbols?.length ?? 0,
      multiSymbolCoverage: snap.multiSymbolCoverage ?? 0,
      atomicFallbackRate: snap.atomicFallbackRate ?? 0,
      decodedStepCount,
      decodedStepCountApproximate: approximate,
      score: snap.result?.score ?? 0,
      complete: snap.result?.complete ?? false,
      steps,
      next: mapNext(snap.next ?? []),
      outcome: mapOutcome(row.outcome),
    };
  }

  const steps = tailSteps(
    (row.steps as Array<{
      token: string;
      start: number;
      end: number;
      emissionScore: number;
      transitionScore: number;
    }>) ?? [],
  );
  const hasCount = typeof row.decodedStepCount === "number";
  return {
    index: Number(row.index),
    symbol: String(row.symbol ?? ""),
    symbolCount: Number(row.symbolCount ?? 0),
    multiSymbolCoverage: Number(row.multiSymbolCoverage ?? 0),
    atomicFallbackRate: Number(row.atomicFallbackRate ?? 0),
    decodedStepCount: hasCount ? Number(row.decodedStepCount) : steps.length,
    decodedStepCountApproximate: !hasCount,
    score: Number(row.score ?? 0),
    complete: Boolean(row.complete),
    steps,
    next: mapNext(row.next),
    outcome: mapOutcome(row.outcome),
  };
}

/**
 * Project runtime events.jsonl decoded rows into compact scrubber frames.
 * Streams the file so large (legacy O(n²)) events.jsonl stays readable.
 */
export async function readRuntimeTimeline(
  root: string,
  runId: string,
): Promise<{ frames: TimelineFrame[]; warning?: string }> {
  const dir = assertSafeRunDir(root, runId);
  const eventsPath = join(dir, "events.jsonl");
  const file = Bun.file(eventsPath);
  if (!(await file.exists())) {
    return { frames: [], warning: "No events.jsonl for this run — replay a transcript first." };
  }

  const frames: TimelineFrame[] = [];
  let truncated = false;

  const rl = createInterface({
    input: createReadStream(eventsPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      let row: Record<string, unknown>;
      try {
        row = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const frame = frameFromRow(row);
      if (!frame) continue;
      if (frames.length >= MAX_FRAMES) {
        truncated = true;
        break;
      }
      frames.push(frame);
    }
  } finally {
    rl.close();
  }

  return {
    frames,
    warning: truncated ? `Timeline truncated to ${MAX_FRAMES} frames.` : undefined,
  };
}
