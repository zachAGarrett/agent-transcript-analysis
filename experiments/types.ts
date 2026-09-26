import type { Producer } from "@/experiments/producers";

export type ExperimentDefinition = {
  name: string;
  version: string;
  createProducer: (opts: { paths: string[] }) => Producer;
};

export type RunJobOptions = {
  /** Absolute paths to sequence source files. */
  paths: string[];
  root?: string;
};

export type RunJobResult = {
  dir: string;
  latticeDb: string;
  sequenceCount: number;
};
