import { realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { patternDisplayLabel } from "./decode";

export type DecodeTraceStep = {
  token: string;
  start: number;
  end: number;
  emissionScore: number;
  transitionScore: number;
  cumulativeScore: number;
};

export type DecodeTraceRecord = {
  id: string;
  sessionId: string;
  symbolCount: number;
  result: {
    tokens: string[];
    steps: DecodeTraceStep[];
    score: number;
    complete: boolean;
  };
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  meanSpan: number;
  segmentsPerStep: number;
  latencyMs: number;
};

export type DecodeTraceListItem = {
  id: string;
  sessionId: string;
  symbolCount: number;
  complete: boolean;
  score: number;
  meanSpan: number;
  atomicFallbackRate: number;
};

export type AlignedDecodeStep = DecodeTraceStep & {
  label: string;
  sourceSymbols: string[];
};

const MAX_JSONL_BYTES = 50_000_000;
const MAX_LIST = 500;

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

export async function listDecodeTraces(
  root: string,
  runId: string,
): Promise<{ traces: DecodeTraceListItem[]; warning?: string }> {
  const dir = assertSafeRunDir(root, runId);
  const file = Bun.file(join(dir, "decodes.jsonl"));
  if (!(await file.exists())) {
    return { traces: [], warning: "No decodes.jsonl for this run." };
  }
  if (file.size > MAX_JSONL_BYTES) throw new Error("decodes.jsonl too large.");
  const text = await file.text();
  const traces: DecodeTraceListItem[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (traces.length >= MAX_LIST) break;
    const row = JSON.parse(line) as DecodeTraceRecord;
    traces.push({
      id: row.id,
      sessionId: row.sessionId,
      symbolCount: row.symbolCount,
      complete: row.result.complete,
      score: row.result.score,
      meanSpan: row.meanSpan,
      atomicFallbackRate: row.atomicFallbackRate,
    });
  }
  return { traces };
}

export async function readDecodeTrace(
  root: string,
  runId: string,
  sequenceId: string,
  sourceSymbols?: string[],
): Promise<{
  trace: DecodeTraceRecord;
  aligned: AlignedDecodeStep[];
  warning?: string;
}> {
  const dir = assertSafeRunDir(root, runId);
  const file = Bun.file(join(dir, "decodes.jsonl"));
  if (!(await file.exists())) throw new Error("No decodes.jsonl for this run.");
  if (file.size > MAX_JSONL_BYTES) throw new Error("decodes.jsonl too large.");
  const text = await file.text();
  let found: DecodeTraceRecord | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as DecodeTraceRecord;
    if (row.id === sequenceId) {
      found = row;
      break;
    }
  }
  if (!found) throw new Error(`Sequence ${sequenceId} not found in decodes.jsonl.`);

  const aligned: AlignedDecodeStep[] = found.result.steps.map((step) => ({
    ...step,
    label: patternDisplayLabel({ key: step.token, token: step.token }),
    sourceSymbols: sourceSymbols?.slice(step.start, step.end) ?? [],
  }));

  return {
    trace: found,
    aligned,
    warning: sourceSymbols ? undefined : "Source symbols not provided; spans lack fixture text.",
  };
}

export type DecodeSummaryFile = {
  version: 1;
  metrics: {
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
  spanLengthBins: { key: string; label: string; value: number }[];
  fallbackRate: number;
  meanSurprisal: number;
  decoderDisagreement?: number;
};

export async function readDecodeSummary(
  root: string,
  runId: string,
): Promise<DecodeSummaryFile | null> {
  const dir = assertSafeRunDir(root, runId);
  const path = join(dir, "decode-summary.json");
  try {
    statSync(path);
  } catch {
    return null;
  }
  const file = Bun.file(path);
  if (file.size > 5_000_000) throw new Error("decode-summary.json too large.");
  return (await file.json()) as DecodeSummaryFile;
}
