import type { LatticeDecodeOptions } from "@khoralabs/tkn";
import type { Producer, Sequence } from "@/experiments/producers";

export type JobRegistry = {
  version: string;
  jobs: Array<{
    id: string;
    createdAt: string;
    dir: string;
    fileCount: number;
  }>;
};

export type BuildReportContext = {
  taggingDir: string;
  latticeDbRel: string;
  trainCount: number;
  heldOutCount: number;
  vocabularySize: number;
  hubTokens: Array<{ pattern: string; confidence: number }>;
  heldOut: Sequence[];
  decode: (sequence: Sequence, options?: LatticeDecodeOptions) => string[];
};

export type ExperimentDefinition = {
  name: string;
  version: string;
  createProducer: (opts: { paths: string[] }) => Producer;
  buildReport: (ctx: BuildReportContext) => unknown;
  printAnalysis: (report: unknown) => void;
};

export type RunJobOptions = {
  /** Absolute paths to fixture CSV files. */
  paths: string[];
  /** Absolute or relative label for the tagging source (for the report). */
  taggingDir: string;
  root?: string;
};
