import { describe, expect, test } from "bun:test";
import type { DecodeResult } from "@khoralabs/tkn";
import {
  aggregateTraces,
  atomicFallbackRate,
  buildDecodeSummary,
  meanSpan,
  meanSurprisal,
  multiSymbolCoverage,
  traceFromDecode,
} from "./metrics";

function result(
  steps: { token: string; start: number; end: number; emissionScore: number }[],
  complete = true,
): DecodeResult {
  const full = steps.map((step, i) => ({
    ...step,
    transitionScore: 0,
    cumulativeScore: steps.slice(0, i + 1).reduce((s, x) => s + x.emissionScore, 0),
  }));
  return {
    complete,
    score: full.at(-1)?.cumulativeScore ?? 0,
    tokens: full.map((step) => step.token),
    steps: full,
  };
}

describe("decode metrics", () => {
  test("empty steps yield zero rates and spans", () => {
    const empty = result([]);
    expect(multiSymbolCoverage(empty, 0)).toBe(1);
    expect(multiSymbolCoverage(empty, 3)).toBe(0);
    expect(atomicFallbackRate(empty)).toBe(0);
    expect(meanSpan(empty)).toBe(0);
    expect(meanSurprisal(empty)).toBe(0);
  });

  test("single-step decode covers full span math", () => {
    const single = result([{ token: "A|", start: 0, end: 1, emissionScore: -1 }]);
    expect(multiSymbolCoverage(single, 1)).toBe(0);
    expect(atomicFallbackRate(single)).toBe(1);
    expect(meanSpan(single)).toBe(1);
    expect(meanSurprisal(single)).toBe(1);

    const digram = result([{ token: "A|B|", start: 0, end: 2, emissionScore: -2 }]);
    expect(multiSymbolCoverage(digram, 2)).toBe(1);
    expect(atomicFallbackRate(digram)).toBe(0);
    expect(meanSpan(digram)).toBe(2);
  });

  test("aggregateTraces and buildDecodeSummary handle empty and mixed traces", () => {
    expect(aggregateTraces([], 0).sequenceCount).toBe(0);
    expect(buildDecodeSummary([], 0).spanLengthBins).toEqual([]);
    expect(buildDecodeSummary([], 0).meanSurprisal).toBe(0);

    const traces = [
      traceFromDecode(
        { id: "a", symbols: ["A|"] },
        "s0",
        result([{ token: "A|", start: 0, end: 1, emissionScore: -1 }]),
        1,
      ),
      traceFromDecode(
        { id: "b", symbols: ["A|", "B|"] },
        "s0",
        result([{ token: "A|B|", start: 0, end: 2, emissionScore: -0.5 }]),
        2,
      ),
    ];
    const summary = buildDecodeSummary(traces, 4);
    expect(summary.metrics.sequenceCount).toBe(2);
    expect(summary.metrics.completeRate).toBe(1);
    expect(summary.spanLengthBins.map((b) => b.key)).toEqual(["1", "2"]);
    expect(summary.fallbackRate).toBe(summary.metrics.atomicFallbackRate);
    expect(summary.meanSurprisal).toBeCloseTo((1 + 0.5) / 2, 5);
  });
});
