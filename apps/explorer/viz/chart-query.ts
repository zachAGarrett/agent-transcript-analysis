export type ChartMeasure = "mass" | "hub" | "outgoing" | "incoming";
export type ChartKind = "overview" | "topPatterns" | "byLength" | "lengthDrill";
export type ChartGrain = "pattern" | "length" | null;

export type ChartQuery = {
  runs: string[];
  kind: ChartKind;
  measure: ChartMeasure;
  limit: number;
  normalize: boolean;
  lengthKey?: string;
};

const MEASURES = new Set<ChartMeasure>(["mass", "hub", "outgoing", "incoming"]);
const KINDS = new Set<ChartKind>(["overview", "topPatterns", "byLength", "lengthDrill"]);

export function chartGrain(kind: ChartKind): ChartGrain {
  if (kind === "byLength") return "length";
  if (kind === "overview") return null;
  return "pattern";
}

export function parseChartQuery(raw: unknown, catalogRuns: string[]): ChartQuery {
  if (!raw || typeof raw !== "object") throw new Error("Invalid chart query.");
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== "string" || !KINDS.has(kind as ChartKind)) {
    throw new Error(`Unknown chart kind: ${String(kind)}`);
  }
  const measure = (o.measure as ChartMeasure | undefined) ?? "mass";
  if (!MEASURES.has(measure)) throw new Error(`Unknown measure: ${String(measure)}`);
  const limit = Number(o.limit ?? 10);
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    throw new Error("limit must be between 1 and 500.");
  }
  const runsRaw = o.runs;
  if (!Array.isArray(runsRaw) || !runsRaw.every((r): r is string => typeof r === "string")) {
    throw new Error("runs must be a string array.");
  }
  const catalog = new Set(catalogRuns);
  const runs = runsRaw.filter((id) => catalog.has(id));
  if (runs.length === 0) throw new Error("No valid runs in query.");
  const lengthKey = typeof o.lengthKey === "string" ? o.lengthKey : undefined;
  if (kind === "lengthDrill" && !lengthKey) throw new Error("lengthKey required for lengthDrill.");
  return {
    runs,
    kind: kind as ChartKind,
    measure,
    limit: Math.floor(limit),
    normalize: Boolean(o.normalize),
    lengthKey,
  };
}
