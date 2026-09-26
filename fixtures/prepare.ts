import { mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Encoding } from "@/fixtures/encoders";
import { Pipeline } from "@/fixtures/pipeline";

/** Directory name for datetime-stamped job / run outputs under a version. */
export const RUNS_DIRNAME = "runs";

export type PrepareOptions = {
  version: string;
  /** When set, only these transcript ids. When omitted with all=true, every parent transcript. */
  transcriptIds?: string[];
  all?: boolean;
  root?: string;
  /** Max concurrent encode/Jev calls per transcript (default 8). */
  concurrency?: number;
};

function jobId(now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:.]/g, "-");
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

type VersionModule = {
  encoder: {
    taxonomy: Array<{ axis: string }>;
    encode: (m: unknown) => Promise<Encoding>;
  } & Record<string, unknown>;
  taxonomy: Array<{ axis: string }>;
  listParentTranscripts: () => Array<{ id: string; path: string }>;
  messagesFromTranscript: (path: string) => AsyncGenerator<unknown>;
};

async function loadVersion(root: string, version: string): Promise<VersionModule> {
  const base = join(root, "fixtures", version);
  const encoderMod = await import(`${base}/encoder.ts`);
  const taxonomyMod = await import(`${base}/taxonomy.ts`);
  const loadMod = await import(`${base}/load.ts`);
  return {
    encoder: encoderMod.encoder,
    taxonomy: taxonomyMod.taxonomy,
    listParentTranscripts: loadMod.listParentTranscripts,
    messagesFromTranscript: loadMod.messagesFromTranscript,
  };
}

export function encodingToCsvRow(encoding: Encoding): string {
  return encoding.atoms
    .map((atom) => {
      if (atom === null) return "";
      const colon = atom.indexOf(":");
      return csvEscape(colon < 0 ? atom : atom.slice(colon + 1));
    })
    .join(",");
}

/**
 * Prepare a fixture job: encode transcripts into CSVs under fixtures/<version>/runs/<datetime>/.
 */
export async function prepareFixtures(options: PrepareOptions): Promise<{
  dir: string;
  fileCount: number;
  id: string;
}> {
  const root = options.root ?? join(import.meta.dir, "..");
  const version = options.version;
  const mod = await loadVersion(root, version);

  const allTranscripts = mod.listParentTranscripts();
  let selected = allTranscripts;
  if (options.transcriptIds && options.transcriptIds.length > 0) {
    const found = new Set(allTranscripts.map((t) => t.id));
    const notFound = options.transcriptIds.filter((id) => !found.has(id));
    if (notFound.length > 0) {
      throw new Error(`Transcript(s) not found: ${notFound.join(", ")}`);
    }
    const want = new Set(options.transcriptIds);
    selected = allTranscripts.filter((t) => want.has(t.id));
  } else if (!options.all) {
    throw new Error("prepareFixtures requires all: true or transcriptIds");
  }

  const createdAt = new Date();
  const id = jobId(createdAt);
  const dirRel = `fixtures/${version}/${RUNS_DIRNAME}/${id}`;
  const dirAbs = join(root, dirRel);
  await mkdir(dirAbs, { recursive: true });

  const pipeline = new Pipeline(mod.encoder as never);
  const header = mod.taxonomy.map((e) => e.axis).join(",");
  const concurrency = Math.max(1, options.concurrency ?? 8);
  let fileCount = 0;

  console.log(`Found ${selected.length} transcripts (of ${allTranscripts.length})`);
  console.log(`Writing job ${dirRel} (concurrency=${concurrency})`);

  for (const transcript of selected) {
    const messages: unknown[] = [];
    for await (const message of mod.messagesFromTranscript(transcript.path)) {
      messages.push(message);
    }

    const csvPath = join(dirAbs, `${transcript.id}.csv`);
    const fh = await open(csvPath, "w");
    let rowCount = 0;
    try {
      await fh.write(`${header}\n`);

      for (let offset = 0; offset < messages.length; offset += concurrency) {
        const batch = messages.slice(offset, offset + concurrency);
        const encodings = await Promise.all(
          batch.map((message) => pipeline.processOne(message as never)),
        );
        for (const encoding of encodings) {
          if (encoding.atoms.every((atom) => atom === null)) continue;
          await fh.write(`${encodingToCsvRow(encoding)}\n`);
          rowCount += 1;
        }
        const done = Math.min(offset + concurrency, messages.length);
        if (done % 50 < concurrency || done === messages.length) {
          console.log(`  ${transcript.id}: ${rowCount} rows (${done}/${messages.length} msgs)`);
        }
      }
    } finally {
      await fh.close();
    }
    fileCount += 1;
    console.log(
      `  wrote ${transcript.id}.csv (${rowCount} rows) [${fileCount}/${selected.length}]`,
    );
  }

  console.log(`Done: ${fileCount} CSVs in ${dirRel}`);
  return { dir: dirRel, fileCount, id };
}

/** Datetime-stamped job folder names under a runs/ (or legacy version) directory. */
export async function listJobIds(runsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    return entries
      .filter((d) => d.isDirectory() && /^\d{4}-/.test(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/** Absolute path to fixtures/<version>/runs. */
export function fixtureRunsDir(root: string, version: string): string {
  return join(root, "fixtures", version, RUNS_DIRNAME);
}

/** Latest fixtures/v* directory name (e.g. v1). */
export async function latestFixtureVersion(root: string): Promise<string> {
  const names = (
    await Array.fromAsync(
      new Bun.Glob("v*").scan({ cwd: join(root, "fixtures"), onlyFiles: false }),
    )
  )
    .filter((n) => !n.includes("/"))
    .sort();
  const last = names.at(-1);
  if (!last) throw new Error("No fixtures/v* versions found");
  return last;
}
