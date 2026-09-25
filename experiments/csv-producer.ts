import { basename, join } from "node:path";
import type { Producer, Sequence } from "@/experiments/producers";
import type { Atom } from "@/fixtures/encoders";
import { encoder } from "@/fixtures/v1/encoder";
import { taxonomy } from "@/fixtures/v1/taxonomy";

export type CsvProducerOptions = {
  /** Directory of tagging-job CSVs, or a single CSV file path. */
  path?: string;
  /** Explicit list of CSV absolute paths (takes precedence over path). */
  paths?: string[];
  /** When set with path dir, only this transcript stem is yielded. */
  onlyId?: string;
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

function rowToAtoms(header: string[], cells: string[]): Array<Atom | null> {
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

export async function loadSequence(filePath: string): Promise<Sequence> {
  const text = await Bun.file(filePath).text();
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const headerLine = lines[0];
  if (!headerLine) throw new Error(`Empty CSV ${filePath}`);
  const header = parseCsvLine(headerLine);
  const symbols: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells = parseCsvLine(line);
    const atoms = rowToAtoms(header, cells);
    if (atoms.every((a) => a === null)) continue;
    symbols.push(encoder.compact(atoms));
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

  if (!(await Bun.file(path).exists()) && !(await Bun.file(join(path, ".")).exists())) {
    // directory existence: try listing
  }

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
 * and yields one Sequence per transcript.
 */
export class CsvProducer implements Producer {
  constructor(private readonly options: CsvProducerOptions) {}

  async *sequences(): AsyncGenerator<Sequence> {
    const files = await resolveFiles(this.options);
    for (const filePath of files) {
      const sequence = await loadSequence(filePath);
      if (this.options.onlyId && sequence.id !== this.options.onlyId) continue;
      yield sequence;
    }
  }
}
