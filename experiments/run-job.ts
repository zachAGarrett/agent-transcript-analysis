import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { ExperimentPipeline } from "@/experiments/pipeline";
import { producerFrom, type Sequence } from "@/experiments/producers";
import type { ExperimentDefinition, RunJobOptions, RunJobResult } from "@/experiments/types";
import { RUNS_DIRNAME } from "@/fixtures/prepare";

export function jobId(now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:.]/g, "-");
}

export async function loadAll(producer: {
  sequences(): AsyncGenerator<Sequence>;
}): Promise<Sequence[]> {
  const out: Sequence[] = [];
  for await (const sequence of producer.sequences()) {
    if (sequence.symbols.length > 0) out.push(sequence);
  }
  return out;
}

/**
 * Shared experiment runner: train a SQLite lattice on all loaded sequences.
 * Canonical artifact: lattice.db under experiments/<name>/<version>/runs/<jobId>/.
 */
export async function runJob(
  definition: ExperimentDefinition,
  options: RunJobOptions,
): Promise<RunJobResult> {
  const root = options.root ?? join(import.meta.dir, "..");
  const createdAt = new Date();
  const id = jobId(createdAt);
  const dirRel = `experiments/${definition.name}/${definition.version}/${RUNS_DIRNAME}/${id}`;
  const dirAbs = join(root, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const latticeDb = join(dirAbs, "lattice.db");

  const producer = definition.createProducer({ paths: options.paths });
  const all = await loadAll(producer);
  if (all.length === 0) {
    throw new Error("No sequences from producer");
  }

  console.log(`${definition.name}@${definition.version}: ${all.length} sequences`);

  const lattice = new Lattice({ filename: latticeDb });
  try {
    const pipeline = new ExperimentPipeline(lattice);
    for await (const _ of pipeline.feed(producerFrom(all))) {
      // ingest
    }
    lattice.invalidateCompiled();
    console.log(`latticeDb=${dirRel}/lattice.db`);
    return { dir: dirRel, latticeDb: `${dirRel}/lattice.db`, sequenceCount: all.length };
  } finally {
    lattice.close();
  }
}
