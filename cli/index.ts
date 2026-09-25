#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { runJob } from "@/experiments/run-job";
import type { ExperimentDefinition } from "@/experiments/types";
import { latestFixtureVersion, listJobIds, prepareFixtures } from "@/fixtures/prepare";

const ROOT = join(import.meta.dir, "..");

function usage(): never {
  console.error(`Usage:
  cli fixtures prepare [-v <version>] (-t <transcriptId> | -a)
  cli experiments <name> [-v <version>] [-fv <fixtureVersion>] [-fj <jobId>]
                         [-g <glob>] [-n <count> | -p <pct>]

Examples:
  bun cli fixtures prepare -v v1 -a
  bun cli fixtures prepare -t 0a146418-e845-4d84-be97-25f32ac5610c
  bun cli experiments agent-turn -fv v1 -n 5
  bun cli experiments session-span -fv v1 -fj 2026-09-24T23-33-14Z -p 20
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

/** experiments/<name>/<version>/experiment.ts — version dirs only (skip datetime run folders). */
async function listVersionDirs(expDir: string): Promise<string[]> {
  try {
    const entries = await readdir(expDir, { withFileTypes: true });
    return entries
      .filter((d) => d.isDirectory() && !/^\d{4}-/.test(d.name))
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
  const versionDir = join(ROOT, "fixtures", version);
  const jobs = await listJobIds(versionDir);
  if (jobs.length === 0) {
    throw new Error(`No job folders under fixtures/${version}/`);
  }
  const id = jobId ?? jobs.at(-1);
  if (!id || !jobs.includes(id)) {
    throw new Error(`Job "${jobId}" not found in fixtures/${version}. Known: ${jobs.join(", ")}`);
  }
  return { version, jobDir: join(versionDir, id), jobId: id };
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
  const all = takeBool(args, "-a");
  if (args.length > 0) usage();
  if ((transcriptId && all) || (!transcriptId && !all)) usage();

  const version = versionFlag ?? (await latestFixtureVersion(ROOT));
  await prepareFixtures({
    version,
    root: ROOT,
    all: all || undefined,
    transcriptIds: transcriptId ? [transcriptId] : undefined,
  });
}

async function cmdExperiments(name: string | undefined, args: string[]): Promise<void> {
  if (!name) usage();
  const version = takeFlag(args, "-v");
  const fv = takeFlag(args, "-fv");
  const fj = takeFlag(args, "-fj");
  const glob = takeFlag(args, "-g") ?? "*.csv";
  const nRaw = takeFlag(args, "-n");
  const pRaw = takeFlag(args, "-p");
  if (args.length > 0) usage();

  const count = nRaw !== undefined ? Number(nRaw) : undefined;
  const pct = pRaw !== undefined ? Number(pRaw) : undefined;
  if (nRaw !== undefined && !Number.isFinite(count)) throw new Error("-n must be a number");
  if (pRaw !== undefined && (pct === undefined || !Number.isFinite(pct) || pct <= 0 || pct > 100)) {
    throw new Error("-p must be a percent in (0, 100]");
  }

  const definition = await resolveExperiment(name, version);
  const { version: fvResolved, jobDir, jobId } = await resolveFixtureJobDir(fv, fj);
  const { paths, matched, selected } = await selectCsvPaths(jobDir, glob, count, pct);
  if (paths.length === 0) {
    throw new Error(`No CSVs matched ${glob} in ${jobDir}`);
  }

  const dirRel = jobDir.startsWith(ROOT) ? jobDir.slice(ROOT.length).replace(/^\//, "") : jobDir;
  console.log(
    `Running ${definition.name}@${definition.version} on fixture job ${jobId} (${selected}/${matched} files)`,
  );
  await runJob(definition, {
    paths,
    producer: {
      kind: "directory",
      dir: dirRel || `fixtures/${fvResolved}`,
      glob,
      sample: {
        matched,
        selected,
        ...(count !== undefined ? { n: count } : {}),
        ...(pct !== undefined ? { pct } : {}),
      },
    },
    root: ROOT,
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) usage();

  const cmd = args.shift();
  if (cmd === "fixtures") {
    const sub = args.shift();
    if (sub !== "prepare") usage();
    await cmdFixturesPrepare(args);
    return;
  }
  if (cmd === "experiments") {
    const name = args.shift();
    await cmdExperiments(name, args);
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
