import { createReadStream, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { createInterface } from "node:readline";

export type TimelineStep = {
  token: string;
  start: number;
  end: number;
  emissionScore: number;
  transitionScore: number;
};

export type TimelineNext = {
  pattern: string;
  weight: number;
  prob: number;
};

export type TimelineFrame = {
  index: number;
  symbol: string;
  symbolCount: number;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  score: number;
  complete: boolean;
  steps: TimelineStep[];
  next: TimelineNext[];
};

/** Top-k for timeline predictive accuracy (matches transition-graph next slots). */
export const TIMELINE_HIT_K = 8;

export type TimelineAccuracyPoint = {
  i: number;
  index: number;
  hit1Cum: number;
  hitKCum: number;
};

/**
 * Cumulative hit@1 / hit@k of frame[i].next vs the next frame's last decoded token.
 * One point per frame; the last frame carries forward the prior cumulative (no new eval).
 */
export function accuracySeries(frames: TimelineFrame[]): TimelineAccuracyPoint[] {
  const out: TimelineAccuracyPoint[] = [];
  let hit1 = 0;
  let hitK = 0;
  let n = 0;
  for (let i = 0; i < frames.length; i++) {
    const pred = frames[i];
    const nextFrame = frames[i + 1];
    if (pred && nextFrame) {
      const actual = nextFrame.steps.at(-1)?.token;
      n += 1;
      if (actual) {
        const ranked = pred.next.slice(0, TIMELINE_HIT_K).map((e) => e.pattern);
        if (ranked[0] === actual) hit1 += 1;
        if (ranked.includes(actual)) hitK += 1;
      }
    }
    out.push({
      i,
      index: pred?.index ?? i,
      hit1Cum: n > 0 ? hit1 / n : 0,
      hitKCum: n > 0 ? hitK / n : 0,
    });
  }
  return out;
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
        next?: TimelineNext[];
      }
    | undefined;

  if (snap) {
    return {
      index: Number(row.index),
      symbol: String(row.symbol ?? ""),
      symbolCount: snap.symbols?.length ?? 0,
      multiSymbolCoverage: snap.multiSymbolCoverage ?? 0,
      atomicFallbackRate: snap.atomicFallbackRate ?? 0,
      score: snap.result?.score ?? 0,
      complete: snap.result?.complete ?? false,
      steps: tailSteps(snap.result?.steps ?? []),
      next: snap.next ?? [],
    };
  }

  return {
    index: Number(row.index),
    symbol: String(row.symbol ?? ""),
    symbolCount: Number(row.symbolCount ?? 0),
    multiSymbolCoverage: Number(row.multiSymbolCoverage ?? 0),
    atomicFallbackRate: Number(row.atomicFallbackRate ?? 0),
    score: Number(row.score ?? 0),
    complete: Boolean(row.complete),
    steps: tailSteps(
      (row.steps as Array<{
        token: string;
        start: number;
        end: number;
        emissionScore: number;
        transitionScore: number;
      }>) ?? [],
    ),
    next: (row.next as TimelineNext[]) ?? [],
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
    warning: truncated
      ? `Timeline truncated to ${MAX_FRAMES} frames.`
      : frames.length === 0
        ? "events.jsonl has no decoded frames."
        : undefined,
  };
}

export async function runHasEvents(root: string, runId: string): Promise<boolean> {
  try {
    const dir = assertSafeRunDir(root, runId);
    return await Bun.file(join(dir, "events.jsonl")).exists();
  } catch {
    return false;
  }
}
