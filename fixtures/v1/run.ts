import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Encoding } from "../encoders";
import { Pipeline } from "../pipeline";
import { encoder } from "./encoder";
import { listParentTranscripts, loadComposerSettings, messagesFromTranscript } from "./load";
import { taxonomy } from "./taxonomy";

const ROOT = join(import.meta.dir, "../..");
const VERSION_DIR = join(ROOT, "fixtures", "v1");
const REGISTRY_PATH = join(VERSION_DIR, "registry.json");

type Registry = {
  version: "v1";
  jobs: Array<{
    id: string;
    createdAt: string;
    dir: string;
    fileCount: number;
  }>;
};

function jobId(now = new Date()): string {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return iso.replace(/[:.]/g, "-");
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

/** Expanded CSV row: one column per taxonomy axis (empty when null). */
export function encodingToCsvRow(encoding: Encoding): string {
  return encoding.atoms
    .map((atom) => {
      if (atom === null) return "";
      const colon = atom.indexOf(":");
      return csvEscape(colon < 0 ? atom : atom.slice(colon + 1));
    })
    .join(",");
}

function csvHeader(): string {
  return taxonomy.map((e) => e.axis).join(",");
}

async function writeCsv(path: string, encodings: Encoding[]): Promise<void> {
  const lines = [csvHeader(), ...encodings.map(encodingToCsvRow)];
  await Bun.write(path, `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const createdAt = new Date();
  const id = jobId(createdAt);
  const dirRel = `fixtures/v1/${id}`;
  const dirAbs = join(ROOT, dirRel);
  await mkdir(dirAbs, { recursive: true });

  const pipeline = new Pipeline(encoder);
  const transcripts = listParentTranscripts();
  let fileCount = 0;

  console.log(`Found ${transcripts.length} parent transcripts`);
  console.log(`Writing job ${dirRel}`);

  for (const transcript of transcripts) {
    const settings = loadComposerSettings(transcript.id);
    const encodings: Encoding[] = [];
    for await (const encoding of pipeline.feed(messagesFromTranscript(transcript.path, settings))) {
      if (encoding.atoms.every((atom) => atom === null)) continue;
      encodings.push(encoding);
    }

    const outPath = join(dirAbs, `${transcript.id}.csv`);
    await writeCsv(outPath, encodings);
    fileCount += 1;
    if (fileCount % 25 === 0) {
      console.log(`  wrote ${fileCount}/${transcripts.length}`);
    }
  }

  const registry = (await Bun.file(REGISTRY_PATH).json()) as Registry;
  registry.jobs.push({
    id,
    createdAt: createdAt.toISOString(),
    dir: dirRel,
    fileCount,
  });
  await Bun.write(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

  console.log(`Done: ${fileCount} CSVs in ${dirRel}`);
}

if (import.meta.main) {
  await main();
}
