import type { DecodeResult } from "@khoralabs/tkn";
import type { Sequence } from "./producers";

export type DecodeTrace = {
  id: string;
  sessionId: string;
  symbolCount: number;
  result: DecodeResult;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  meanSpan: number;
  segmentsPerStep: number;
  latencyMs: number;
};

export type AggregateDecodeMetrics = {
  sequenceCount: number;
  completeRate: number;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  meanSpan: number;
  meanSegmentsPerStep: number;
  meanScore: number;
  meanLatencyMs: number;
  vocabularySize: number;
};

export type DecodeSummaryBin = {
  key: string;
  label: string;
  value: number;
};

export type DecodeSummary = {
  version: 1;
  metrics: AggregateDecodeMetrics;
  spanLengthBins: DecodeSummaryBin[];
  fallbackRate: number;
  meanSurprisal: number;
  decoderDisagreement?: number;
};

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

export function meanSpan(result: DecodeResult): number {
  if (result.steps.length === 0) return 0;
  let sum = 0;
  for (const step of result.steps) sum += spanLength(step);
  return sum / result.steps.length;
}

export function meanSurprisal(result: DecodeResult): number {
  if (result.steps.length === 0) return 0;
  let sum = 0;
  for (const step of result.steps) {
    // emissionScore is log-prob; surprisal = -log P
    sum += -step.emissionScore;
  }
  return sum / result.steps.length;
}

export function traceFromDecode(
  sequence: Sequence,
  sessionId: string,
  result: DecodeResult,
  latencyMs: number,
): DecodeTrace {
  const symbolCount = sequence.symbols.length;
  return {
    id: sequence.id,
    sessionId,
    symbolCount,
    result,
    multiSymbolCoverage: multiSymbolCoverage(result, symbolCount),
    atomicFallbackRate: atomicFallbackRate(result),
    meanSpan: meanSpan(result),
    segmentsPerStep: symbolCount === 0 ? 0 : result.steps.length / symbolCount,
    latencyMs,
  };
}

export function aggregateTraces(
  traces: DecodeTrace[],
  vocabularySize: number,
): AggregateDecodeMetrics {
  const n = traces.length;
  if (n === 0) {
    return {
      sequenceCount: 0,
      completeRate: 0,
      multiSymbolCoverage: 0,
      atomicFallbackRate: 0,
      meanSpan: 0,
      meanSegmentsPerStep: 0,
      meanScore: 0,
      meanLatencyMs: 0,
      vocabularySize,
    };
  }
  let complete = 0;
  let multi = 0;
  let atomic = 0;
  let span = 0;
  let segs = 0;
  let score = 0;
  let latency = 0;
  for (const t of traces) {
    if (t.result.complete) complete += 1;
    multi += t.multiSymbolCoverage;
    atomic += t.atomicFallbackRate;
    span += t.meanSpan;
    segs += t.segmentsPerStep;
    score += t.result.score;
    latency += t.latencyMs;
  }
  return {
    sequenceCount: n,
    completeRate: complete / n,
    multiSymbolCoverage: multi / n,
    atomicFallbackRate: atomic / n,
    meanSpan: span / n,
    meanSegmentsPerStep: segs / n,
    meanScore: score / n,
    meanLatencyMs: latency / n,
    vocabularySize,
  };
}

export function buildDecodeSummary(traces: DecodeTrace[], vocabularySize: number): DecodeSummary {
  const metrics = aggregateTraces(traces, vocabularySize);
  const spanCounts = new Map<number, number>();
  let surprisalSum = 0;
  let surprisalN = 0;
  for (const t of traces) {
    for (const step of t.result.steps) {
      const len = Math.min(32, spanLength(step));
      spanCounts.set(len, (spanCounts.get(len) ?? 0) + 1);
      surprisalSum += -step.emissionScore;
      surprisalN += 1;
    }
  }
  const spanLengthBins: DecodeSummaryBin[] = [...spanCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([len, value]) => ({
      key: String(len),
      label: len === 32 ? "32+" : String(len),
      value,
    }));
  return {
    version: 1,
    metrics,
    spanLengthBins,
    fallbackRate: metrics.atomicFallbackRate,
    meanSurprisal: surprisalN === 0 ? 0 : surprisalSum / surprisalN,
  };
}
