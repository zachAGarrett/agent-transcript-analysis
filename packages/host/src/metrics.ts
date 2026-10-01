import type { DecodeResult } from "@khoralabs/tkn";

function spanLength(step: { start: number; end: number }): number {
  return step.end - step.start;
}

/** Fraction of source symbols covered by multi-symbol (length > 1) decoded steps. */
export function multiSymbolCoverage(result: DecodeResult, symbolCount: number): number {
  if (symbolCount === 0) return 1;
  let covered = 0;
  for (const step of result.steps) {
    const len = spanLength(step);
    if (len > 1) covered += len;
  }
  return covered / symbolCount;
}

/** Fraction of decoded steps that are length-1 (atomic fallback or singleton). */
export function atomicFallbackRate(result: DecodeResult): number {
  if (result.steps.length === 0) return 0;
  let atomic = 0;
  for (const step of result.steps) {
    if (spanLength(step) === 1) atomic += 1;
  }
  return atomic / result.steps.length;
}
