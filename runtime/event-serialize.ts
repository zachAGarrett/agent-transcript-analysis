import type { LoopEvent } from "./loop";

/** Bound steps retained per decoded event (avoids O(n²) events.jsonl). */
export const DECODED_STEPS_TAIL = 64;

/**
 * Serialize a loop event for events.jsonl.
 * Decoded rows keep metrics + a steps tail — not the growing symbols[] prefix.
 * `decodedStepCount` preserves the full step count before truncation.
 */
export function serializeLoopEvent(event: LoopEvent): string {
  if (event.kind !== "decoded") return JSON.stringify(event);

  const { snapshot, outcome } = event;
  const allSteps = snapshot.result.steps;
  const steps =
    allSteps.length > DECODED_STEPS_TAIL ? allSteps.slice(-DECODED_STEPS_TAIL) : allSteps;

  return JSON.stringify({
    kind: "decoded",
    index: event.index,
    symbol: event.symbol,
    symbolCount: snapshot.symbols.length,
    multiSymbolCoverage: snapshot.multiSymbolCoverage,
    atomicFallbackRate: snapshot.atomicFallbackRate,
    decodedStepCount: snapshot.decodedStepCount,
    score: snapshot.result.score,
    complete: snapshot.result.complete,
    steps: steps.map((s) => ({
      token: s.token,
      start: s.start,
      end: s.end,
      emissionScore: s.emissionScore,
      transitionScore: s.transitionScore,
    })),
    next: snapshot.next,
    outcome,
  });
}
