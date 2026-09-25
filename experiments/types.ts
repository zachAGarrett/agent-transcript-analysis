import type { LatticeDecodeOptions } from "@khoralabs/tkn";
import type { Producer, Sequence } from "@/experiments/producers";

/** How a directory producer selected files for a run. */
export type DirectorySample = {
  matched: number;
  selected: number;
  n?: number;
  pct?: number;
};

/** Producer provenance recorded on the job (extensible by kind). */
export type ProducerSource = {
  kind: "directory";
  dir: string;
  glob: string;
  sample: DirectorySample;
};

export type BuildReportContext = {
  producer: ProducerSource;
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
  /** Build self-contained HTML for a report.json of this experiment. */
  renderCharts: (report: unknown, opts: { sourcePath: string }) => string;
};

export type RunJobOptions = {
  /** Absolute paths to sequence source files. */
  paths: string[];
  /** Producer provenance for the report (agnostic of experiment). */
  producer: ProducerSource;
  root?: string;
};
