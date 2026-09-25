import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { ExperimentPipeline } from "@/experiments/pipeline";
import { producerFrom, type Sequence } from "@/experiments/producers";
import type { ExperimentDefinition, JobRegistry, RunJobOptions } from "@/experiments/types";

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

export function splitTrainHeldOut(sequences: Sequence[]): {
  train: Sequence[];
  heldOut: Sequence[];
} {
  const sorted = [...sequences].sort((a, b) => a.id.localeCompare(b.id));
  if (sorted.length === 1) {
    return { train: sorted, heldOut: sorted };
  }
  const cut = Math.max(1, Math.floor(sorted.length * 0.8));
  return { train: sorted.slice(0, cut), heldOut: sorted.slice(cut) };
}

async function appendRegistry(
  registryPath: string,
  version: string,
  entry: JobRegistry["jobs"][number],
): Promise<void> {
  let registry: JobRegistry;
  if (await Bun.file(registryPath).exists()) {
    registry = (await Bun.file(registryPath).json()) as JobRegistry;
  } else {
    registry = { version, jobs: [] };
  }
  registry.jobs.push(entry);
  await Bun.write(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

/**
 * Shared experiment runner: train SQLite lattice, decode held-out, analyze, register.
 */
export async function runJob(
  definition: ExperimentDefinition,
  options: RunJobOptions,
): Promise<unknown> {
  const root = options.root ?? join(import.meta.dir, "..");
  const createdAt = new Date();
  const id = jobId(createdAt);
  const dirRel = `experiments/${definition.name}/${definition.version}/${id}`;
  const dirAbs = join(root, dirRel);
  await mkdir(dirAbs, { recursive: true });
  const latticeDb = join(dirAbs, "lattice.db");
  const registryPath = join(
    root,
    "experiments",
    definition.name,
    definition.version,
    "registry.json",
  );

  const producer = definition.createProducer({ paths: options.paths });
  const all = await loadAll(producer);
  if (all.length === 0) {
    throw new Error(`No sequences from ${options.taggingDir}`);
  }

  const { train, heldOut } = splitTrainHeldOut(all);
  console.log(
    `${definition.name}@${definition.version}: ${all.length} sequences (train=${train.length} heldOut=${heldOut.length})`,
  );

  const lattice = new Lattice({ filename: latticeDb });
  try {
    const pipeline = new ExperimentPipeline(lattice);
    for await (const _ of pipeline.feed(producerFrom(train))) {
      // ingest
    }
    lattice.invalidateCompiled();

    const report = definition.buildReport({
      taggingDir: options.taggingDir,
      latticeDbRel: `${dirRel}/lattice.db`,
      trainCount: train.length,
      heldOutCount: heldOut.length,
      vocabularySize: lattice.vocabulary().length,
      hubTokens: lattice.getTopTokens(100),
      heldOut,
      decode: pipeline.decode.bind(pipeline),
    });

    await Bun.write(join(dirAbs, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    await appendRegistry(registryPath, definition.version, {
      id,
      createdAt: createdAt.toISOString(),
      dir: dirRel,
      fileCount: heldOut.length,
    });

    definition.printAnalysis(report);
    return report;
  } finally {
    lattice.close();
  }
}
