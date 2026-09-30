import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PredictionOutcome } from "@/runtime/predictor";
import {
  accuracySeries,
  compressionSeries,
  readRuntimeTimeline,
  type TimelineFrame,
} from "./runtime-timeline";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function outcome(
  partial: Partial<PredictionOutcome> & { actualSymbol: string },
): PredictionOutcome {
  return {
    covered: true,
    rank: 1,
    hit1: true,
    hitK: true,
    reciprocalRank: 1,
    softPrefixHit: false,
    ...partial,
  };
}

function frame(
  index: number,
  overrides: Partial<TimelineFrame> & { symbol: string },
): TimelineFrame {
  return {
    index,
    symbolCount: index + 1,
    multiSymbolCoverage: 0,
    atomicFallbackRate: 1,
    decodedStepCount: index + 1,
    decodedStepCountApproximate: false,
    score: 0,
    complete: true,
    steps: [
      {
        token: overrides.symbol,
        start: index,
        end: index + 1,
        emissionScore: 0,
        transitionScore: 0,
      },
    ],
    next: [],
    ...overrides,
  };
}

describe("accuracySeries", () => {
  test("rolling hit@1 / hit@k / coverage from persisted outcomes; no lookahead", () => {
    const frames: TimelineFrame[] = [
      frame(0, { symbol: "A|" }),
      frame(1, {
        symbol: "B|",
        outcome: outcome({ actualSymbol: "B|", hit1: true, hitK: true, reciprocalRank: 1 }),
      }),
      frame(2, {
        symbol: "C|",
        outcome: outcome({
          actualSymbol: "C|",
          hit1: false,
          hitK: true,
          rank: 2,
          reciprocalRank: 0.5,
        }),
      }),
      frame(3, {
        symbol: "D|",
        outcome: outcome({
          actualSymbol: "D|",
          covered: false,
          rank: null,
          hit1: false,
          hitK: false,
          reciprocalRank: 0,
        }),
      }),
    ];
    const series = accuracySeries(frames, 2);
    expect(series).toHaveLength(4);
    // Frame 0: no outcome yet
    expect(series[0]).toMatchObject({ hit1: 0, hitK: 0, coverage: 0, window: 0, mrr: 0 });
    // Frame 1: one hit
    expect(series[1]).toMatchObject({ hit1: 1, hitK: 1, coverage: 1, window: 1, mrr: 1 });
    // Frame 2: window [hit1, miss@1]
    expect(series[2]?.hit1).toBeCloseTo(0.5);
    expect(series[2]?.hitK).toBeCloseTo(1);
    expect(series[2]?.mrr).toBeCloseTo(0.75);
    expect(series[2]?.coverage).toBe(1);
    expect(series[2]?.window).toBe(2);
    // Frame 3: window [hit@k, uncovered miss] — uncovered counted as miss
    expect(series[3]?.hit1).toBe(0);
    expect(series[3]?.hitK).toBeCloseTo(0.5);
    expect(series[3]?.coverage).toBeCloseTo(0.5);
    expect(series[3]?.window).toBe(2);
  });
});

describe("compressionSeries", () => {
  test("reduction = 1 − steps/symbols; zero and first-frame edge cases", () => {
    const frames: TimelineFrame[] = [
      frame(0, { symbol: "A|", symbolCount: 1, decodedStepCount: 1 }),
      frame(1, { symbol: "B|", symbolCount: 4, decodedStepCount: 2 }),
      frame(2, {
        symbol: "C|",
        symbolCount: 8,
        decodedStepCount: 2,
        multiSymbolCoverage: 0.5,
        atomicFallbackRate: 0.25,
        decodedStepCountApproximate: true,
      }),
    ];
    const series = compressionSeries(frames);
    expect(series[0]).toMatchObject({
      reduction: 0,
      meanSpan: 1,
      approximate: false,
    });
    expect(series[1]?.reduction).toBeCloseTo(0.5);
    expect(series[1]?.meanSpan).toBeCloseTo(2);
    expect(series[2]?.reduction).toBeCloseTo(0.75);
    expect(series[2]?.meanSpan).toBeCloseTo(4);
    expect(series[2]).toMatchObject({
      multiSymbolCoverage: 0.5,
      atomicFallbackRate: 0.25,
      approximate: true,
    });
  });
});

describe("readRuntimeTimeline", () => {
  test("projects decoded events into compact frames and skips tagged", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-timeline-"));
    dirs.push(root);
    const runId = "2026-09-29T17-19-08Z";
    mkdirSync(join(root, runId));
    const lines = [
      JSON.stringify({
        kind: "tagged",
        index: 0,
        symbol: "a.|",
        encoding: { atoms: ["tag:a"] },
      }),
      JSON.stringify({
        kind: "decoded",
        index: 0,
        symbol: "a.|",
        snapshot: {
          symbols: ["a.|"],
          result: {
            tokens: ["a.|"],
            steps: [
              {
                token: "a.|",
                start: 0,
                end: 1,
                emissionScore: 1,
                transitionScore: 0,
                cumulativeScore: 1,
              },
            ],
            score: 1,
            complete: true,
          },
          multiSymbolCoverage: 0,
          atomicFallbackRate: 1,
          next: [{ pattern: "b.|", symbol: "b.|", weight: 2, prob: 1, source: "tip" }],
        },
      }),
      JSON.stringify({
        kind: "decoded",
        index: 1,
        symbol: "b.|",
        snapshot: {
          symbols: ["a.|", "b.|"],
          result: {
            tokens: ["a.|", "b.|"],
            steps: [
              {
                token: "a.|",
                start: 0,
                end: 1,
                emissionScore: 1,
                transitionScore: 0,
                cumulativeScore: 1,
              },
              {
                token: "b.|",
                start: 1,
                end: 2,
                emissionScore: 1,
                transitionScore: 1,
                cumulativeScore: 2,
              },
            ],
            score: 2,
            complete: true,
          },
          multiSymbolCoverage: 0,
          atomicFallbackRate: 1,
          next: [],
        },
        outcome: {
          actualSymbol: "b.|",
          covered: true,
          rank: 1,
          hit1: true,
          hitK: true,
          reciprocalRank: 1,
          softPrefixHit: true,
        },
      }),
      JSON.stringify({ kind: "sessionEnded", symbolCount: 2 }),
    ];
    writeFileSync(join(root, runId, "events.jsonl"), `${lines.join("\n")}\n`);

    const { frames, warning } = await readRuntimeTimeline(root, runId);
    expect(warning).toBeUndefined();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      index: 0,
      symbol: "a.|",
      symbolCount: 1,
      complete: true,
      decodedStepCount: 1,
      decodedStepCountApproximate: true,
      next: [{ pattern: "b.|", symbol: "b.|", weight: 2, prob: 1, source: "tip" }],
    });
    expect(frames[0]?.steps).toHaveLength(1);
    expect(frames[1]?.symbolCount).toBe(2);
    expect(frames[1]?.steps).toHaveLength(2);
    expect(frames[1]?.outcome?.actualSymbol).toBe("b.|");
    expect("symbols" in (frames[0] as object)).toBe(false);
  });

  test("missing events.jsonl returns empty with warning", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-timeline-empty-"));
    dirs.push(root);
    const runId = "job";
    mkdirSync(join(root, runId));
    const { frames, warning } = await readRuntimeTimeline(root, runId);
    expect(frames).toEqual([]);
    expect(warning).toMatch(/No events\.jsonl/);
  });

  test("reads compact decoded rows with decodedStepCount; marks legacy approximate", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-timeline-compact-"));
    dirs.push(root);
    const runId = "compact-job";
    mkdirSync(join(root, runId));
    writeFileSync(
      join(root, runId, "events.jsonl"),
      `${JSON.stringify({
        kind: "decoded",
        index: 0,
        symbol: "a.|",
        symbolCount: 10,
        multiSymbolCoverage: 0.2,
        atomicFallbackRate: 0.1,
        decodedStepCount: 4,
        score: 1,
        complete: true,
        steps: [{ token: "a.|", start: 9, end: 10, emissionScore: 1, transitionScore: 0 }],
        next: [],
      })}\n${JSON.stringify({
        kind: "decoded",
        index: 1,
        symbol: "b.|",
        symbolCount: 2,
        multiSymbolCoverage: 0,
        atomicFallbackRate: 1,
        score: 1,
        complete: true,
        steps: [
          { token: "a.|", start: 0, end: 1, emissionScore: 1, transitionScore: 0 },
          { token: "b.|", start: 1, end: 2, emissionScore: 1, transitionScore: 0 },
        ],
        next: [],
      })}\n`,
    );
    const { frames, warning } = await readRuntimeTimeline(root, runId);
    expect(warning).toBeUndefined();
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({
      index: 0,
      symbol: "a.|",
      symbolCount: 10,
      decodedStepCount: 4,
      decodedStepCountApproximate: false,
    });
    expect(frames[1]).toMatchObject({
      decodedStepCount: 2,
      decodedStepCountApproximate: true,
    });
  });
});
