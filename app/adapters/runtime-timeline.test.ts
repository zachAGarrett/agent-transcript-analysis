import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accuracySeries, readRuntimeTimeline, type TimelineFrame } from "./runtime-timeline";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame(
  index: number,
  lastToken: string,
  next: Array<{ pattern: string; weight: number; prob: number }>,
): TimelineFrame {
  return {
    index,
    symbol: lastToken,
    symbolCount: index + 1,
    multiSymbolCoverage: 0,
    atomicFallbackRate: 1,
    score: 0,
    complete: true,
    steps: [
      { token: lastToken, start: index, end: index + 1, emissionScore: 0, transitionScore: 0 },
    ],
    next,
  };
}

describe("accuracySeries", () => {
  test("cumulative hit@1 and hit@k against next frame tip token", () => {
    const frames: TimelineFrame[] = [
      frame(0, "A", [
        { pattern: "B", weight: 1, prob: 1 },
        { pattern: "C", weight: 0, prob: 0 },
      ]),
      frame(1, "B", [
        { pattern: "Z", weight: 1, prob: 1 },
        { pattern: "C", weight: 0, prob: 0 },
      ]),
      frame(2, "C", [{ pattern: "D", weight: 1, prob: 1 }]),
      frame(3, "D", []),
    ];
    const series = accuracySeries(frames);
    expect(series).toHaveLength(4);
    // 0→1: B is top-1 → hit1=1, hitK=1
    expect(series[0]).toMatchObject({ hit1Cum: 1, hitKCum: 1 });
    // 1→2: C is in top-k but not top-1 → hit1=1/2, hitK=2/2
    expect(series[1]?.hit1Cum).toBeCloseTo(0.5);
    expect(series[1]?.hitKCum).toBeCloseTo(1);
    // 2→3: D is top-1 → hit1=2/3, hitK=3/3
    expect(series[2]?.hit1Cum).toBeCloseTo(2 / 3);
    expect(series[2]?.hitKCum).toBeCloseTo(1);
    // last frame carries forward (no new prediction)
    expect(series[3]).toMatchObject({
      hit1Cum: series[2]?.hit1Cum,
      hitKCum: series[2]?.hitKCum,
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
          next: [{ pattern: "b.|", weight: 2, prob: 1 }],
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
      next: [{ pattern: "b.|", weight: 2, prob: 1 }],
    });
    expect(frames[0]?.steps).toHaveLength(1);
    expect(frames[1]?.symbolCount).toBe(2);
    expect(frames[1]?.steps).toHaveLength(2);
    // Compact: no symbols array on the frame.
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

  test("reads compact decoded rows without snapshot", async () => {
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
        symbolCount: 1,
        multiSymbolCoverage: 0,
        atomicFallbackRate: 1,
        score: 1,
        complete: true,
        steps: [{ token: "a.|", start: 0, end: 1, emissionScore: 1, transitionScore: 0 }],
        next: [],
      })}\n`,
    );
    const { frames, warning } = await readRuntimeTimeline(root, runId);
    expect(warning).toBeUndefined();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ index: 0, symbol: "a.|", symbolCount: 1, complete: true });
    expect(frames[0]?.steps).toHaveLength(1);
  });
});
