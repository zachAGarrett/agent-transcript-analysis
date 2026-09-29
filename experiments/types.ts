import type { LatticeDecodeOptions } from "@khoralabs/tkn";
import type { Producer } from "@/experiments/producers";
import type { AggregateDecodeMetrics } from "./metrics";

export type ExperimentDefinition = {
  name: string;
  version: string;
  createProducer: (opts: { paths: string[]; fixtureVersion: string; root?: string }) => Producer;
};

export type RunJobOptions = {
  /** Absolute paths to sequence source files. */
  paths: string[];
  /** Fixture scheme version used to rebuild composites (`v1`, `v2`, …). */
  fixtureVersion: string;
  root?: string;
  /** Fixture job id for provenance (optional). */
  fixtureJobId?: string;
  /** Hold-out percent of sessions in (0, 100). When set, decode held-out after train. */
  holdoutPct?: number;
  /** Seed for session shuffle (default 1). */
  seed?: number;
  /** Decode options for held-out evaluation. */
  decodeOptions?: LatticeDecodeOptions;
  /** Compile-time LM smoothing (tkn default 0.1 when omitted). */
  smoothing?: number;
  /** When true, skip held-out decode even if holdoutPct is set. */
  skipDecode?: boolean;
};

export type RunJobResult = {
  dir: string;
  latticeDb: string;
  sequenceCount: number;
  trainCount: number;
  heldOutCount: number;
  metrics?: AggregateDecodeMetrics;
  reportPath?: string;
  decodesPath?: string;
  decodeSummaryPath?: string;
};
