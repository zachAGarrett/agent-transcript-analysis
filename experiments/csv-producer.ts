import { basename, join } from "node:path";
import type { Producer, Sequence } from "@/experiments/producers";
import type { Atom } from "@/fixtures/encoders";
import { type FixtureScheme, loadFixtureScheme } from "@/fixtures/scheme";

export type CsvProducerOptions = {
  /** Directory of tagging-job CSVs, or a single CSV file path. */
  path?: string;
  /** Explicit list of CSV absolute paths (takes precedence over path). */
  paths?: string[];
  /** When set with path dir, only this transcript stem is yielded. */
  onlyId?: string;
  /** Fixture scheme version (`v1`, `v2`, …). */
  fixtureVersion: string;
  /** Repo root containing `fixtures/<version>/`. */
  root?: string;
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function rowToAtoms(
  header: string[],
  cells: string[],
  taxonomy: readonly { axis: string }[],
): Array<Atom | null> {
  const byAxis = new Map<string, string>();
  for (let i = 0; i < header.length; i++) {
    const axis = header[i];
    if (!axis) continue;
    const value = cells[i] ?? "";
    if (value !== "") byAxis.set(axis, value);
  }
  return taxonomy.map((entry) => {
    const value = byAxis.get(entry.axis);
    return value === undefined ? null : `${entry.axis}:${value}`;
  });
}

function assertHeaderMatches(
  filePath: string,
  header: string[],
  taxonomy: readonly { axis: string }[],
): void {
  const expected = taxonomy.map((t) => t.axis);
  if (header.length !== expected.length || header.some((h, i) => h !== expected[i])) {
    throw new Error(
      `CSV header mismatch in ${filePath}: expected [${expected.join(",")}], got [${header.join(",")}]`,
    );
  }
}

/** Rebuild one sequence from a tagging CSV using the given fixture scheme. */
export async function loadSequence(filePath: string, scheme: FixtureScheme): Promise<Sequence> {
  const text = await Bun.file(filePath).text();
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (!headerLine) throw new Error(`Empty CSV ${filePath}`);
  const header = parseCsvLine(headerLine);
  assertHeaderMatches(filePath, header, scheme.taxonomy);
  const symbols: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = parseCsvLine(line);
    const atoms = rowToAtoms(header, cells, scheme.taxonomy);
    if (atoms.every((a) => a === null)) continue;
    symbols.push(scheme.encoder.compact(atoms));
  }
  const id = basename(filePath, ".csv");
  return { id, symbols };
}

async function resolveFiles(options: CsvProducerOptions): Promise<string[]> {
  if (options.paths && options.paths.length > 0) {
    return [...options.paths].sort();
  }
  const path = options.path;
  if (!path) throw new Error("CsvProducer requires path or paths");

  if (path.endsWith(".csv")) {
    return [path];
  }

  const names = (
    await Array.fromAsync(new Bun.Glob("*.csv").scan({ cwd: path, onlyFiles: true }))
  ).sort();
  return names
    .filter((name) => {
      if (!options.onlyId) return true;
      return basename(name, ".csv") === options.onlyId;
    })
    .map((name) => join(path, name));
}

/**
 * Producer that reads tagging-pipeline CSV jobs (or explicit CSV paths)
 * and yields one Sequence per transcript, compacted with the fixture scheme.
 */
export class CsvProducer implements Producer {
  constructor(private readonly options: CsvProducerOptions) {}

  async *sequences(): AsyncGenerator<Sequence> {
    const root = this.options.root ?? join(import.meta.dir, "..");
    const scheme = await loadFixtureScheme(root, this.options.fixtureVersion);
    const files = await resolveFiles(this.options);
    for (const filePath of files) {
      const sequence = await loadSequence(filePath, scheme);
      if (this.options.onlyId && sequence.id !== this.options.onlyId) continue;
      yield sequence;
    }
  }
}
