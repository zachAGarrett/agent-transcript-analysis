/**
 * Server-only: reads events.jsonl. Browser code must import from
 * `./runtime-timeline-model` (or the re-exports below stay unused in HTML entry).
 */
import { createReadStream, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";
import type {
  TimelineFrame,
  TimelineNext,
  TimelineOutcome,
  TimelineStep,
} from "./runtime-timeline-model";

export type {
  ScorerProvenance,
  TimelineAccuracyPoint,
  TimelineCompressionPoint,
  TimelineFrame,
  TimelineNext,
  TimelineOutcome,
  TimelineStep,
} from "./runtime-timeline-model";
export {
  accuracySeries,
  compressionSeries,
  TIMELINE_ACCURACY_WINDOW,
  TIMELINE_HIT_K,
} from "./runtime-timeline-model";

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
    const row = e as TimelineNext & { pattern: string; weight: number; prob: number };
    return {
      pattern: String(row.pattern ?? ""),
      symbol: row.symbol !== undefined ? String(row.symbol) : undefined,
      weight: Number(row.weight ?? 0),
      prob: Number(row.prob ?? 0),
      source: row.source,
    };
  });
}

function mapOutcome(raw: unknown): TimelineOutcome | undefined {
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
