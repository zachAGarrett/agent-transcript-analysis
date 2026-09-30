import { describe, expect, test } from "bun:test";
import type { DecodeSnapshot } from "./decoder";
import { DECODED_STEPS_TAIL, serializeLoopEvent } from "./event-serialize";
import type { DecodedEvent } from "./loop";

describe("serializeLoopEvent", () => {
  test("persists decodedStepCount before truncating the steps tail", () => {
    const fullCount = DECODED_STEPS_TAIL + 20;
    const steps = Array.from({ length: fullCount }, (_, i) => ({
      token: `t${i}|`,
      start: i,
      end: i + 1,
      emissionScore: 0,
      transitionScore: 0,
      cumulativeScore: 0,
    }));
    const snapshot: DecodeSnapshot = {
      symbols: steps.map((s) => s.token),
      result: {
        tokens: steps.map((s) => s.token),
        steps,
        score: 0,
        complete: true,
      },
      multiSymbolCoverage: 0,
      atomicFallbackRate: 1,
      decodedStepCount: fullCount,
      next: [],
    };
    const event: DecodedEvent = {
      kind: "decoded",
      index: fullCount - 1,
      symbol: steps[fullCount - 1]?.token ?? "",
      snapshot,
    };
    const row = JSON.parse(serializeLoopEvent(event)) as {
      decodedStepCount: number;
      symbolCount: number;
      steps: unknown[];
    };
    expect(row.decodedStepCount).toBe(fullCount);
    expect(row.symbolCount).toBe(fullCount);
    expect(row.steps).toHaveLength(DECODED_STEPS_TAIL);
    expect(row.decodedStepCount).toBeGreaterThan(row.steps.length);
  });
});
