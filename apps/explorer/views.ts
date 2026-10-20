import type { ChartKind, ChartMeasure, ChartQuery } from "@/app/viz/chart-query";
import type { DisplaySpec } from "@/app/viz/types";

export type ExplorerViewId = "lattice" | "connectivity" | "replay";

/** Connectivity measure axis (outgoing / incoming / hub). */
export type ConnMeasureId = "outgoing" | "incoming" | "hub";

export type ConnMeasureSpec = {
  id: ConnMeasureId;
  label: string;
  measure: ChartMeasure;
};

export const CONN_MEASURES: ConnMeasureSpec[] = [
  { id: "outgoing", label: "Outgoing", measure: "outgoing" },
  { id: "incoming", label: "Incoming", measure: "incoming" },
  { id: "hub", label: "Hub", measure: "hub" },
];

export function connMeasure(id: ConnMeasureId): ConnMeasureSpec {
  const found = CONN_MEASURES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown connectivity measure: ${id}`);
  return found;
}

export type ChartSpec = {
  id: string;
  title: string;
  kind: Exclude<ChartKind, "lengthDrill">;
  /** Default measure when there is no measure picker. */
  measure?: ChartMeasure;
  /** Run-scalar overview chart (multi-run by default). */
  overview?: boolean;
  /**
   * Length select: All = global top-k for the active measure/mass;
   * a numeric key drills that length.
   */
  lengthPicker?: boolean;
  /** Connectivity measure select (Outgoing / Incoming / Hub). */
  measurePicker?: boolean;
  /**
   * Histogram of the active measure by length.
   * Mutual with lengthPicker on Connectivity.
   */
  lengthHistogram?: boolean;
};

export type CategoryViewSpec = {
  id: Exclude<ExplorerViewId, "replay">;
  title: string;
  description: string;
  charts: ChartSpec[];
};

/** Fixed multi-chart pages for the explorer (no interactive path composition). */
export const CATEGORY_VIEWS: Record<Exclude<ExplorerViewId, "replay">, CategoryViewSpec> = {
  lattice: {
    id: "lattice",
    title: "Lattice",
    description: "Where is the mass?",
    charts: [
      { id: "overview", title: "Run scalars", kind: "overview", overview: true },
      {
        id: "patterns",
        title: "Top patterns",
        kind: "topPatterns",
        measure: "mass",
        lengthPicker: true,
      },
      { id: "lengths", title: "Mass by length", kind: "byLength", measure: "mass" },
    ],
  },
  connectivity: {
    id: "connectivity",
    title: "Connectivity",
    description: "How does the graph connect?",
    charts: [
      {
        id: "patterns",
        title: "Top patterns",
        kind: "topPatterns",
        measure: "outgoing",
        lengthPicker: true,
        measurePicker: true,
      },
      {
        id: "lengths",
        title: "Weight by length",
        kind: "byLength",
        measure: "outgoing",
        measurePicker: true,
        lengthHistogram: true,
      },
    ],
  },
};

export const EXPLORER_VIEWS: {
  id: ExplorerViewId;
  title: string;
  description: string;
}[] = [
  {
    id: "lattice",
    title: CATEGORY_VIEWS.lattice.title,
    description: CATEGORY_VIEWS.lattice.description,
  },
  {
    id: "connectivity",
    title: CATEGORY_VIEWS.connectivity.title,
    description: CATEGORY_VIEWS.connectivity.description,
  },
  {
    id: "replay",
    title: "Replay",
    description: "How did decode unfold?",
  },
];

/** Resolve the chart measure for a spec given optional connectivity measure. */
export function resolveChartMeasure(
  spec: ChartSpec,
  measureId: ConnMeasureId = "outgoing",
): ChartMeasure {
  if (spec.measurePicker) return connMeasure(measureId).measure;
  return spec.measure ?? "mass";
}

function runsForDisplay(
  display: DisplaySpec,
  catalogRuns: string[],
  selectedRunId: string,
): string[] {
  if (display.faceted) return catalogRuns;
  return selectedRunId ? [selectedRunId] : catalogRuns.slice(0, 1);
}

/** Build a ChartQuery from a fixed chart spec + display knobs. */
export function buildChartQuery(
  spec: ChartSpec,
  display: DisplaySpec,
  catalogRuns: string[],
  selectedRunId: string,
  measureId: ConnMeasureId = "outgoing",
): ChartQuery {
  const runs =
    spec.kind === "overview" || spec.overview
      ? catalogRuns
      : runsForDisplay(display, catalogRuns, selectedRunId);
  return {
    runs,
    kind: spec.kind,
    measure: resolveChartMeasure(spec, measureId),
    limit: display.limit,
    normalize: display.normalized,
  };
}

/** Top patterns for one composite length. */
export function buildLengthDrillQuery(
  lengthKey: string,
  display: DisplaySpec,
  catalogRuns: string[],
  selectedRunId: string,
  measure: ChartMeasure = "mass",
): ChartQuery {
  if (!lengthKey) throw new Error("lengthKey is required.");
  return {
    runs: runsForDisplay(display, catalogRuns, selectedRunId),
    kind: "lengthDrill",
    measure,
    limit: display.limit,
    normalize: display.normalized,
    lengthKey,
  };
}
