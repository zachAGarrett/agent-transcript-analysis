import {
  applyPath,
  compilePlan,
  type DisplaySpec,
  initialPathState,
  Morphism,
  type PathPlan,
  presetPaths,
  sessionFromPathState,
  withDisplay,
} from "@workstream/lattice-viz";

export type ExplorerViewId = "lattice" | "connectivity" | "replay";

/** Load morphisms legal for length drill plans. */
export type PatternLoadMorphism =
  | typeof Morphism.loadPatternMass
  | typeof Morphism.loadEdgeWeight
  | typeof Morphism.loadInDegree
  | typeof Morphism.loadHub;

/** Connectivity measure axis (outgoing / incoming / hub). */
export type ConnMeasureId = "outgoing" | "incoming" | "hub";

export type ConnMeasureSpec = {
  id: ConnMeasureId;
  label: string;
  /** Pattern top-k preset. */
  topPreset: keyof typeof presetPaths;
  /** Length-histogram preset. */
  lengthPreset: keyof typeof presetPaths;
  /** Load morphism for length drills. */
  load: PatternLoadMorphism;
};

export const CONN_MEASURES: ConnMeasureSpec[] = [
  {
    id: "outgoing",
    label: "Outgoing",
    topPreset: "connectivity",
    lengthPreset: "lengths-by-edge",
    load: Morphism.loadEdgeWeight,
  },
  {
    id: "incoming",
    label: "Incoming",
    topPreset: "inflows",
    lengthPreset: "lengths-by-in",
    load: Morphism.loadInDegree,
  },
  {
    id: "hub",
    label: "Hub",
    topPreset: "hubs",
    lengthPreset: "lengths-by-hub",
    load: Morphism.loadHub,
  },
];

export function connMeasure(id: ConnMeasureId): ConnMeasureSpec {
  const found = CONN_MEASURES.find((m) => m.id === id);
  if (!found) throw new Error(`Unknown connectivity measure: ${id}`);
  return found;
}

export type ChartSpec = {
  id: string;
  title: string;
  /** Default preset when there is no measure picker (or lattice mass). */
  preset: keyof typeof presetPaths;
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
   * Histogram of the active measure by length (uses measure.lengthPreset).
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
      { id: "overview", title: "Run scalars", preset: "overview", overview: true },
      { id: "patterns", title: "Top patterns", preset: "patterns", lengthPicker: true },
      { id: "lengths", title: "Mass by length", preset: "lengths" },
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
        preset: "connectivity",
        lengthPicker: true,
        measurePicker: true,
      },
      {
        id: "lengths",
        title: "Weight by length",
        preset: "lengths-by-edge",
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

/** Resolve the executable preset for a chart given optional connectivity measure. */
export function resolveChartPreset(
  spec: ChartSpec,
  measureId: ConnMeasureId = "outgoing",
): keyof typeof presetPaths {
  if (!spec.measurePicker) return spec.preset;
  const m = connMeasure(measureId);
  return spec.lengthHistogram ? m.lengthPreset : m.topPreset;
}

/** Build an executable PathPlan from a named preset + display knobs. */
export function buildChartPlan(
  presetId: keyof typeof presetPaths,
  display: DisplaySpec,
  catalogRuns: string[],
  selectedRunId: string,
): PathPlan {
  const steps = presetPaths[presetId];
  if (!steps?.length) throw new Error(`Unknown preset: ${String(presetId)}`);
  let state = initialPathState;
  for (const step of steps) {
    const next = applyPath(state, step.name, step.params);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  let session = sessionFromPathState(state, catalogRuns, selectedRunId);
  session = withDisplay(session, display);
  const plan = compilePlan(session);
  return {
    ...plan,
    steps: plan.steps.map((step) =>
      step.name === Morphism.partitionByLength
        ? { ...step, params: { ...step.params, limit: display.limit } }
        : step,
    ),
  };
}

/**
 * Top patterns for one composite length:
 * load → rollup length → commit → drill_length_patterns.
 */
export function buildLengthPatternsPlan(
  lengthKey: string,
  display: DisplaySpec,
  catalogRuns: string[],
  selectedRunId: string,
  load: PatternLoadMorphism = Morphism.loadPatternMass,
): PathPlan {
  if (!lengthKey) throw new Error("lengthKey is required.");
  let state = initialPathState;
  for (const name of [load, Morphism.rollupLength, Morphism.commit] as const) {
    const next = applyPath(state, name);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  const drilled = applyPath(state, Morphism.drillLengthPatterns, {
    lengthKey,
    limit: display.limit,
  });
  if (!drilled.ok) throw new Error(drilled.error);
  state = drilled.state;
  let session = sessionFromPathState(state, catalogRuns, selectedRunId);
  session = withDisplay(session, {
    ...display,
    limit: display.limit,
  });
  return compilePlan(session);
}
