import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AggregateDecodeMetrics, DecodeSummary, DecodeTrace } from "./metrics";

export type RunReport = {
  version: 1;
  job: {
    experiment: string;
    experimentVersion: string;
    fixtureVersion: string;
    fixtureJobId?: string;
    createdAt: string;
    seed?: number;
    holdoutPct?: number;
    trainCount: number;
    heldOutCount: number;
    trainSessionIds?: string[];
    holdoutSessionIds?: string[];
    paths?: string[];
    decodeOptions?: Record<string, unknown>;
    smoothing?: number;
    sequenceBoundary: "endSequence";
    artifacts: {
      latticeDb: string;
      decodesJsonl: string | null;
      decodeSummaryJson: string | null;
    };
  };
  metrics?: AggregateDecodeMetrics;
};

export async function writeReport(dirAbs: string, report: RunReport): Promise<string> {
  const path = join(dirAbs, "report.json");
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}

export async function writeDecodesJsonl(dirAbs: string, traces: DecodeTrace[]): Promise<string> {
  const path = join(dirAbs, "decodes.jsonl");
  const body = traces.map((t) => JSON.stringify(t)).join("\n");
  await writeFile(path, body.length > 0 ? `${body}\n` : "");
  return path;
}

export async function writeDecodeSummary(dirAbs: string, summary: DecodeSummary): Promise<string> {
  const path = join(dirAbs, "decode-summary.json");
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
  return path;
}
