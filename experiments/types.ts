import type { Producer } from "@/experiments/producers";

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
};

export type RunJobResult = {
  dir: string;
  latticeDb: string;
  sequenceCount: number;
};
