#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runJob } from "@/experiments/run-job";
import { scoreLatticeDb } from "@/experiments/score-lattice";
import type { ExperimentDefinition } from "@/experiments/types";
import {
  fixtureRunsDir,
  latestFixtureVersion,
  listJobIds,
  prepareFixtures,
  RUNS_DIRNAME,
} from "@/fixtures/prepare";
import { replayTranscript, runtimeRunsDir } from "@/runtime/replay";

const ROOT = join(import.meta.dir, "..");

function usage(): never {
  console.error(`Usage:
  cli fixtures prepare [-v <version>] (-t <transcriptId> | -a) [-c <concurrency>]
  cli experiments <name> [-v <version>] [-fv <fixtureVersion>] [-fj <jobId>]
                         [-g <glob>] [-n <count> | -p <pct>]
                         [--holdout <pct>] [--seed <n>] [--beam <width>] [--unigram]
  cli experiments sweep [-e <name>] [-fv <fixtureVersion>] [-fj <jobId>] [-n <count>]
                         [--holdout <pct>] [--seed <n>] [--kind decoder|lm]
  cli runtime replay -t <transcriptId> [-v <version>] [-c <concurrency>]
                     [--recompile-every <n>] [--commit-batch <n>]
  cli score <path-to-lattice.db>

Examples:
  bun cli fixtures prepare -v v1 -a
  bun cli fixtures prepare -v v2 -t 3478de7b-79b9-458d-9028-1db767ff17fc -c 12
  bun cli fixtures prepare -t 0a146418-e845-4d84-be97-25f32ac5610c
  bun cli experiments agent-turn -fv v1 -n 5
  bun cli experiments session-span -fv v1 -fj 2026-09-24T23-33-14Z -p 20 --holdout 20 --seed 1
  bun cli experiments agent-turn -fv v2 -fj 2026-09-25T22-55-36Z --beam 16
  bun cli runtime replay -v v1 -t 0a146418-e845-4d84-be97-25f32ac5610c
  bun cli score experiments/agent-turn/v1/runs/<jobId>/lattice.db
`);
  process.exit(1);
}

function takeFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${name} requires a value`);
  }
  args.splice(i, 2);
  return value;
}

function takeBool(args: string[], name: string): boolean {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}

/** experiments/<name>/<version>/experiment.ts — skip runs/ and datetime folders. */
async function listVersionDirs(expDir: string): Promise<string[]> {
  try {
    const entries = await readdir(expDir, { withFileTypes: true });
    return entries
      .filter((d) => d.isDirectory() && d.name !== RUNS_DIRNAME && !/^\d{4}-/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

async function listExperimentNames(): Promise<string[]> {
  const root = join(ROOT, "experiments");
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const d of entries) {
    if (!d.isDirectory()) continue;
    const versions = await listVersionDirs(join(root, d.name));
    for (const ver of versions) {
      if (await Bun.file(join(root, d.name, ver, "experiment.ts")).exists()) {
        names.push(d.name);
        break;
      }
    }
  }
  return names.sort();
}

async function resolveExperiment(
  name: string,
  version: string | undefined,
): Promise<ExperimentDefinition> {
  const expDir = join(ROOT, "experiments", name);
  const versions = await listVersionDirs(expDir);
  const withModule: string[] = [];
  for (const ver of versions) {
    if (await Bun.file(join(expDir, ver, "experiment.ts")).exists()) withModule.push(ver);
  }
  if (withModule.length === 0) {
    const known = await listExperimentNames();
    throw new Error(
      `Unknown experiment "${name}". Known: ${known.length > 0 ? known.join(", ") : "(none)"}`,
    );
  }
  const ver = version ?? withModule.at(-1);
  if (!ver || !withModule.includes(ver)) {
    throw new Error(`Unknown version "${version}" for ${name}. Known: ${withModule.join(", ")}`);
  }
  const abs = join(expDir, ver, "experiment.ts");
  const mod = await import(abs);
  const definition = (mod.experiment ?? mod.default) as ExperimentDefinition | undefined;
  if (!definition)
    throw new Error(`Module ${name}/${ver}/experiment.ts does not export experiment`);
  return definition;
}

async function resolveFixtureJobDir(
  fixtureVersion: string | undefined,
  jobId: string | undefined,
): Promise<{ version: string; jobDir: string; jobId: string }> {
  const version = fixtureVersion ?? (await latestFixtureVersion(ROOT));
  const runsDir = fixtureRunsDir(ROOT, version);
  const jobs = await listJobIds(runsDir);
  if (jobs.length === 0) {
    throw new Error(`No job folders under fixtures/${version}/runs/`);
  }
  const id = jobId ?? jobs.at(-1);
  if (!id || !jobs.includes(id)) {
    throw new Error(
      `Job "${jobId}" not found in fixtures/${version}/runs. Known: ${jobs.join(", ")}`,
    );
  }
  return { version, jobDir: join(runsDir, id), jobId: id };
}

async function selectCsvPaths(
  jobDir: string,
  glob: string,
  count: number | undefined,
  pct: number | undefined,
): Promise<{ paths: string[]; matched: number; selected: number }> {
  const names = (
    await Array.fromAsync(new Bun.Glob(glob).scan({ cwd: jobDir, onlyFiles: true }))
  ).sort();
  let selected = names;
  if (count !== undefined && pct !== undefined) {
    throw new Error("Use only one of -n or -p");
  }
  if (count !== undefined) {
    selected = names.slice(0, Math.max(0, count));
  } else if (pct !== undefined) {
    const n = Math.max(1, Math.floor((names.length * pct) / 100));
    selected = names.slice(0, n);
  }
  return {
    paths: selected.map((name) => join(jobDir, name)),
    matched: names.length,
    selected: selected.length,
  };
}

async function cmdFixturesPrepare(args: string[]): Promise<void> {
  const versionFlag = takeFlag(args, "-v");
  const transcriptId = takeFlag(args, "-t");
  const concurrencyRaw = takeFlag(args, "-c");
  const all = takeBool(args, "-a");
  if (args.length > 0) usage();
  if ((transcriptId && all) || (!transcriptId && !all)) usage();
  const concurrency = concurrencyRaw !== undefined ? Number(concurrencyRaw) : undefined;
  if (
    concurrencyRaw !== undefined &&
    (concurrency === undefined || !Number.isInteger(concurrency) || concurrency < 1)
  ) {
    throw new Error("-c must be a positive integer");
  }

  const version = versionFlag ?? (await latestFixtureVersion(ROOT));
  await prepareFixtures({
    version,
    root: ROOT,
    all: all || undefined,
    transcriptIds: transcriptId ? [transcriptId] : undefined,
    concurrency,
  });
}

async function cmdExperimentsRun(name: string, args: string[]): Promise<void> {
  const version = takeFlag(args, "-v");
  const fv = takeFlag(args, "-fv");
  const fj = takeFlag(args, "-fj");
  const glob = takeFlag(args, "-g") ?? "*.csv";
  const nRaw = takeFlag(args, "-n");
  const pRaw = takeFlag(args, "-p");
  const holdoutRaw = takeFlag(args, "--holdout");
  const seedRaw = takeFlag(args, "--seed");
  const beamRaw = takeFlag(args, "--beam");
  const unigram = takeBool(args, "--unigram");
  if (args.length > 0) usage();

  const count = nRaw !== undefined ? Number(nRaw) : undefined;
  const pct = pRaw !== undefined ? Number(pRaw) : undefined;
  if (nRaw !== undefined && !Number.isFinite(count)) throw new Error("-n must be a number");
  if (pRaw !== undefined && (pct === undefined || !Number.isFinite(pct) || pct <= 0 || pct > 100)) {
    throw new Error("-p must be a percent in (0, 100]");
  }
  const holdoutPct = holdoutRaw !== undefined ? Number(holdoutRaw) : undefined;
  if (
    holdoutRaw !== undefined &&
    (holdoutPct === undefined ||
      !Number.isFinite(holdoutPct) ||
      holdoutPct <= 0 ||
      holdoutPct >= 100)
  ) {
    throw new Error("--holdout must be a percent in (0, 100)");
  }
  const seed = seedRaw !== undefined ? Number(seedRaw) : undefined;
  if (seedRaw !== undefined && (seed === undefined || !Number.isInteger(seed))) {
    throw new Error("--seed must be an integer");
  }
  const beamWidth = beamRaw !== undefined ? Number(beamRaw) : undefined;
  if (
    beamRaw !== undefined &&
    (beamWidth === undefined || !Number.isInteger(beamWidth) || beamWidth <= 0)
  ) {
    throw new Error("--beam must be a positive integer");
  }

  const definition = await resolveExperiment(name, version);
  const { version: fixtureVersion, jobDir, jobId } = await resolveFixtureJobDir(fv, fj);
  const { paths, matched, selected } = await selectCsvPaths(jobDir, glob, count, pct);
  if (paths.length === 0) {
    throw new Error(`No CSVs matched ${glob} in ${jobDir}`);
  }

  const decodeOptions =
    beamWidth !== undefined
      ? { mode: "beam" as const, beamWidth, useBigram: !unigram }
      : unigram
        ? { mode: "viterbi" as const, useBigram: false }
        : undefined;

  console.log(
    `Running ${definition.name}@${definition.version} on fixture ${fixtureVersion} job ${jobId} (${selected}/${matched} files)`,
  );
  const result = await runJob(definition, {
    paths,
    fixtureVersion,
    fixtureJobId: jobId,
    root: ROOT,
    holdoutPct,
    seed,
    decodeOptions,
  });
  console.log(
    `Done: ${result.latticeDb} (train=${result.trainCount} holdout=${result.heldOutCount})`,
  );
}

async function cmdRuntimeReplay(args: string[]): Promise<void> {
  const versionFlag = takeFlag(args, "-v");
  const transcriptId = takeFlag(args, "-t");
  const concurrencyRaw = takeFlag(args, "-c");
  const recompileRaw = takeFlag(args, "--recompile-every");
  const commitBatchRaw = takeFlag(args, "--commit-batch");
  if (args.length > 0 || !transcriptId) usage();

  const concurrency = concurrencyRaw !== undefined ? Number(concurrencyRaw) : undefined;
  if (
    concurrencyRaw !== undefined &&
    (concurrency === undefined || !Number.isInteger(concurrency) || concurrency < 1)
  ) {
    throw new Error("-c must be a positive integer");
  }
  const recompileEvery = recompileRaw !== undefined ? Number(recompileRaw) : undefined;
  if (
    recompileRaw !== undefined &&
    (recompileEvery === undefined || !Number.isInteger(recompileEvery) || recompileEvery < 1)
  ) {
    throw new Error("--recompile-every must be a positive integer");
  }
  const commitBatchSize = commitBatchRaw !== undefined ? Number(commitBatchRaw) : undefined;
  if (
    commitBatchRaw !== undefined &&
    (commitBatchSize === undefined || !Number.isInteger(commitBatchSize) || commitBatchSize < 1)
  ) {
    throw new Error("--commit-batch must be a positive integer");
  }

  const version = versionFlag ?? (await latestFixtureVersion(ROOT));
  console.log(`Replaying transcript ${transcriptId} with fixtures/${version} encoder`);
  const result = await replayTranscript({
    transcriptId,
    version,
    root: ROOT,
    concurrency,
    recompileEvery,
    commitBatchSize,
  });
  const runsAbs = runtimeRunsDir(ROOT, version);
  console.log(`Done: ${result.dir} (symbols=${result.symbolCount})`);
  console.log(`Explore: EXPLORER_RUNS=${runsAbs} bun run visualize`);
}

async function cmdExperimentsSweep(args: string[]): Promise<void> {
  const experimentName = takeFlag(args, "-e") ?? "session-span";
  const version = takeFlag(args, "-v");
  const fv = takeFlag(args, "-fv");
  const fj = takeFlag(args, "-fj");
  const glob = takeFlag(args, "-g") ?? "*.csv";
  const nRaw = takeFlag(args, "-n");
  const holdoutRaw = takeFlag(args, "--holdout") ?? "20";
  const seedRaw = takeFlag(args, "--seed") ?? "1";
  const kind = takeFlag(args, "--kind") ?? "decoder";
  if (args.length > 0) usage();

  if (kind !== "decoder" && kind !== "lm") {
    throw new Error("--kind must be decoder or lm");
  }
  const count = nRaw !== undefined ? Number(nRaw) : 30;
  if (nRaw !== undefined && (!Number.isInteger(count) || count <= 0)) {
    throw new Error("-n must be a positive integer");
  }
  const holdoutPct = Number(holdoutRaw);
  const seed = Number(seedRaw);
  if (!Number.isFinite(holdoutPct) || holdoutPct <= 0 || holdoutPct >= 100) {
    throw new Error("--holdout must be in (0, 100)");
  }
  if (!Number.isInteger(seed)) {
    throw new Error("--seed must be an integer");
  }

  const { DEFAULT_DECODER_SWEEPS, DEFAULT_LM_SWEEPS, runSweeps } = await import(
    "@/experiments/sweeps"
  );
  const { loadAll } = await import("@/experiments/run-job");
  const definition = await resolveExperiment(experimentName, version);
  const { version: fixtureVersion, jobDir, jobId } = await resolveFixtureJobDir(fv, fj);
  const { paths } = await selectCsvPaths(jobDir, glob, count, undefined);
  const producer = definition.createProducer({
    paths,
    fixtureVersion,
    root: ROOT,
  });
  const sequences = await loadAll(producer);
  const configs = kind === "lm" ? DEFAULT_LM_SWEEPS : DEFAULT_DECODER_SWEEPS;
  const outDir = join(
    ROOT,
    "experiments",
    definition.name,
    definition.version,
    RUNS_DIRNAME,
    `sweep-${jobId}-${kind}`,
  );
  console.log(`Sweep ${kind} on ${definition.name} (${sequences.length} sequences)`);
  await runSweeps({ sequences, holdoutPct, seed, configs, outDir });
  console.log(`Wrote ${outDir}/sweeps.json`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) usage();

  const cmd = args.shift();
  if (cmd === "fixtures") {
    const sub = args.shift();
    if (sub === "prepare") {
      await cmdFixturesPrepare(args);
      return;
    }
    usage();
  }
  if (cmd === "experiments") {
    const name = args.shift();
    if (!name) usage();
    if (name === "sweep") {
      await cmdExperimentsSweep(args);
      return;
    }
    await cmdExperimentsRun(name, args);
    return;
  }
  if (cmd === "runtime") {
    const sub = args.shift();
    if (sub === "replay") {
      await cmdRuntimeReplay(args);
      return;
    }
    usage();
  }
  if (cmd === "score") {
    const path = args.shift();
    if (!path || args.length > 0) usage();
    const abs = path.startsWith("/") ? path : join(ROOT, path);
    const { scored } = scoreLatticeDb(abs);
    console.log(`Scored ${abs} (${scored} nodes with hub_score ≠ 0)`);
    return;
  }
  usage();
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
