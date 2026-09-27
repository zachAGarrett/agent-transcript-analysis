import {
  ConstraintRepository,
  type Schema,
  type StateSpace,
  StateSpaceRepository,
  type Transition,
} from "@statespace/core";
import { MAX_PATH_STEPS, type PathStep, type TipKind } from "./algebra";

export type PathState = {
  tip: TipKind;
  grain: "none" | "run" | "pattern" | "length" | "pattern-by-length";
  measure: "none" | "stored-count" | "vocabulary" | "edge-weight";
  source: "none" | "pattern-mass" | "pattern-vocab" | "edge-weight" | "run-scalars";
  faceted: boolean;
  normalized: boolean;
  hasTopK: boolean;
  rankedByLength: boolean;
  limit: number;
  stepCount: number;
  steps: PathStep[];
  hasSelection: boolean;
  selectionRunId: string;
  selectionBinKey: string;
  selectionPatternId: number;
  selectionLengthKey: string;
  detailRequested: boolean;
};

export type SelectionContext = {
  runId: string;
  binKey: string;
  patternId?: number;
  lengthKey?: string;
};

export const initialPathState: PathState = {
  tip: "query",
  grain: "none",
  measure: "none",
  source: "none",
  faceted: false,
  normalized: false,
  hasTopK: false,
  rankedByLength: false,
  limit: 10,
  stepCount: 0,
  steps: [],
  hasSelection: false,
  selectionRunId: "",
  selectionBinKey: "",
  selectionPatternId: 0,
  selectionLengthKey: "",
  detailRequested: false,
};

const pathStateSchema: Schema<PathState> = {
  type: "object",
  additionalProperties: false,
  required: [
    "tip",
    "grain",
    "measure",
    "source",
    "faceted",
    "normalized",
    "hasTopK",
    "rankedByLength",
    "limit",
    "stepCount",
    "steps",
    "hasSelection",
    "selectionRunId",
    "selectionBinKey",
    "selectionPatternId",
    "selectionLengthKey",
    "detailRequested",
  ],
  properties: {
    tip: {
      type: "string",
      enum: ["query", "summary", "displayed", "faceted", "selected", "committed"],
    },
    grain: { type: "string", enum: ["none", "run", "pattern", "length", "pattern-by-length"] },
    measure: {
      type: "string",
      enum: ["none", "stored-count", "vocabulary", "edge-weight"],
    },
    source: {
      type: "string",
      enum: ["none", "pattern-mass", "pattern-vocab", "edge-weight", "run-scalars"],
    },
    faceted: { type: "boolean" },
    normalized: { type: "boolean" },
    hasTopK: { type: "boolean" },
    rankedByLength: { type: "boolean" },
    limit: { type: "number" },
    stepCount: { type: "number" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          params: {
            type: "object",
            additionalProperties: true,
            required: [],
            nullable: true,
          },
        },
      },
    },
    hasSelection: { type: "boolean" },
    selectionRunId: { type: "string" },
    selectionBinKey: { type: "string" },
    selectionPatternId: { type: "number" },
    selectionLengthKey: { type: "string" },
    detailRequested: { type: "boolean" },
  },
};

function guard(
  fn: (state: PathState) => boolean,
  message: string,
): Transition<PathState>["constraints"][number] {
  return {
    path: "tip",
    phase: "before_transition",
    validation: ConstraintRepository.createImperative<PathState, "tip">((_v, state) => ({
      success: fn(state),
      message,
    })),
  };
}

function patch(
  name: string,
  update: (state: PathState, context?: unknown) => PathState,
  constraints: Transition<PathState>["constraints"],
): Transition<PathState> {
  return {
    name,
    constraints,
    effect: {
      path: "tip",
      operation: "transform",
      value: (_path, state, context) => {
        try {
          const current = state as PathState;
          if (
            current.stepCount >= MAX_PATH_STEPS &&
            name !== "commit" &&
            name !== "clear_selection"
          ) {
            return { success: false, error: "Path too long." };
          }
          const next = update(current, context);
          return { success: true, state: next };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "transform failed",
          };
        }
      },
    },
  };
}

function append(state: PathState, name: string, params?: Record<string, unknown>): PathState {
  const step: PathStep = params ? { name, params } : { name };
  return {
    ...state,
    steps: [...state.steps, step],
    stepCount: state.stepCount + 1,
  };
}

const underCap = guard((s) => s.stepCount < MAX_PATH_STEPS, "Path step cap reached.");

const transitions: Transition<PathState>[] = [
  patch(
    "load_pattern_mass",
    (s) =>
      append(
        {
          ...s,
          tip: "summary",
          grain: "pattern",
          measure: "stored-count",
          source: "pattern-mass",
        },
        "load_pattern_mass",
      ),
    [underCap, guard((s) => s.tip === "query" && s.source === "none", "Need query tip.")],
  ),
  patch(
    "load_pattern_vocab",
    (s) =>
      append(
        {
          ...s,
          tip: "summary",
          grain: "pattern",
          measure: "vocabulary",
          source: "pattern-vocab",
        },
        "load_pattern_vocab",
      ),
    [underCap, guard((s) => s.tip === "query" && s.source === "none", "Need query tip.")],
  ),
  patch(
    "load_edge_weight",
    (s) =>
      append(
        {
          ...s,
          tip: "summary",
          grain: "pattern",
          measure: "edge-weight",
          source: "edge-weight",
        },
        "load_edge_weight",
      ),
    [underCap, guard((s) => s.tip === "query" && s.source === "none", "Need query tip.")],
  ),
  patch(
    "load_run_scalars",
    (s) =>
      append(
        {
          ...s,
          tip: "summary",
          grain: "run",
          measure: "stored-count",
          source: "run-scalars",
        },
        "load_run_scalars",
      ),
    [underCap, guard((s) => s.tip === "query" && s.source === "none", "Need query tip.")],
  ),
  patch(
    "rollup_length",
    (s) =>
      append(
        {
          ...s,
          tip: "summary",
          grain: "length",
          rankedByLength: false,
        },
        "rollup_length",
      ),
    [
      underCap,
      guard(
        (s) =>
          s.tip === "summary" &&
          s.grain === "pattern" &&
          !s.hasTopK &&
          s.source !== "run-scalars" &&
          s.source !== "edge-weight",
        "Rollup needs pattern summary before top-k.",
      ),
    ],
  ),
  patch(
    "rank_by_length",
    (s) =>
      append(
        {
          ...s,
          tip: "summary",
          grain: "pattern",
          rankedByLength: true,
        },
        "rank_by_length",
      ),
    [
      underCap,
      guard(
        (s) =>
          s.tip === "summary" &&
          s.grain === "pattern" &&
          !s.hasTopK &&
          !s.rankedByLength &&
          (s.source === "pattern-mass" || s.source === "pattern-vocab"),
        "Rank by length needs pattern mass/vocab summary before top-k.",
      ),
    ],
  ),
  patch(
    "partition_by_length",
    (s) =>
      append(
        {
          ...s,
          tip: s.faceted ? "faceted" : "displayed",
          grain: "pattern-by-length",
          hasTopK: true,
          rankedByLength: false,
        },
        "partition_by_length",
        { limit: s.limit },
      ),
    [
      underCap,
      guard(
        (s) =>
          s.tip === "summary" &&
          s.grain === "pattern" &&
          !s.hasTopK &&
          (s.source === "pattern-mass" || s.source === "pattern-vocab"),
        "Partition by length needs pattern mass/vocab summary before top-k.",
      ),
    ],
  ),
  ...([5, 10, 20] as const).map((n) =>
    patch(
      `top_k_${n}`,
      (s) =>
        append(
          {
            ...s,
            tip: s.faceted ? "faceted" : "displayed",
            hasTopK: true,
            limit: n,
          },
          `top_k_${n}`,
          { limit: n },
        ),
      [
        underCap,
        guard(
          (s) =>
            (s.tip === "summary" || (s.tip === "faceted" && !s.hasTopK)) &&
            s.grain !== "run" &&
            s.source !== "run-scalars" &&
            !s.hasTopK,
          "Top-k needs aggregate summary (not run-scalars).",
        ),
      ],
    ),
  ),
  patch(
    "normalize",
    (s) =>
      append(
        {
          ...s,
          tip: s.faceted ? "faceted" : "displayed",
          normalized: true,
        },
        "normalize",
      ),
    [
      underCap,
      guard(
        (s) =>
          (s.tip === "summary" || s.tip === "displayed" || s.tip === "faceted") &&
          s.grain !== "run" &&
          !s.normalized &&
          s.source !== "run-scalars",
        "Normalize after aggregation; once only.",
      ),
    ],
  ),
  patch(
    "facet_runs",
    (s) =>
      append(
        {
          ...s,
          tip: s.hasTopK || s.normalized ? "faceted" : "faceted",
          faceted: true,
        },
        "facet_runs",
      ),
    [
      underCap,
      guard(
        (s) =>
          (s.tip === "summary" || s.tip === "displayed") &&
          !s.faceted &&
          s.source !== "run-scalars",
        "Facet once from summary/displayed.",
      ),
    ],
  ),
  patch("commit", (s) => append({ ...s, tip: "committed" }, "commit"), [
    guard(
      (s) =>
        s.tip === "displayed" ||
        s.tip === "faceted" ||
        (s.tip === "summary" && (s.grain === "run" || s.grain === "length")),
      "Commit from renderable tip.",
    ),
  ]),
  // Follow-ups / selection
  patch(
    "select_bin",
    (s, context) => {
      const sel = context as SelectionContext | undefined;
      if (!sel?.runId || !sel.binKey) {
        throw new Error("Selection context required.");
      }
      return append(
        {
          ...s,
          tip: "selected",
          hasSelection: true,
          selectionRunId: sel.runId,
          selectionBinKey: sel.binKey,
          selectionPatternId: sel.patternId ?? 0,
          selectionLengthKey: sel.lengthKey ?? "",
          detailRequested: false,
        },
        "select_bin",
        { ...sel },
      );
    },
    [
      underCap,
      guard(
        (s) =>
          s.tip === "committed" ||
          s.tip === "displayed" ||
          s.tip === "faceted" ||
          s.tip === "selected",
        "Select from a rendered view.",
      ),
    ],
  ),
  patch(
    "clear_selection",
    (s) =>
      append(
        {
          ...s,
          tip: s.faceted ? "faceted" : "committed",
          hasSelection: false,
          selectionRunId: "",
          selectionBinKey: "",
          selectionPatternId: 0,
          selectionLengthKey: "",
          detailRequested: false,
        },
        "clear_selection",
      ),
    [guard((s) => s.hasSelection || s.tip === "selected", "No selection.")],
  ),
  patch(
    "open_pattern_detail",
    (s) => append({ ...s, detailRequested: true }, "open_pattern_detail"),
    [
      underCap,
      guard(
        (s) => (s.tip === "selected" || s.hasSelection) && s.selectionPatternId > 0,
        "Need a pattern selection.",
      ),
    ],
  ),
  patch(
    "focus_run",
    (s) =>
      append(
        {
          ...s,
          faceted: false,
          tip: "committed",
        },
        "focus_run",
        { runId: s.selectionRunId },
      ),
    [
      underCap,
      guard(
        (s) => s.faceted && s.hasSelection && s.selectionRunId.length > 0,
        "Focus needs faceted view + run selection.",
      ),
    ],
  ),
  patch(
    "drill_length_patterns",
    (s) =>
      append(
        {
          ...s,
          tip: "committed",
          grain: "pattern-by-length",
          hasTopK: true,
          rankedByLength: false,
          hasSelection: false,
          detailRequested: false,
        },
        "drill_length_patterns",
        { limit: s.limit },
      ),
    [
      underCap,
      guard(
        (s) =>
          (s.tip === "selected" || s.hasSelection) &&
          s.selectionLengthKey.length > 0 &&
          s.selectionLengthKey !== "other" &&
          (s.source === "pattern-mass" || s.source === "pattern-vocab"),
        "Drill needs a length-bin selection on a pattern source.",
      ),
    ],
  ),
  patch(
    "re_rollup",
    (s) =>
      append(
        {
          ...s,
          tip: "committed",
          grain: "length",
          hasTopK: false,
          rankedByLength: false,
          normalized: false,
          hasSelection: false,
        },
        "re_rollup",
      ),
    [
      underCap,
      guard(
        (s) =>
          (s.tip === "committed" || s.tip === "selected" || s.tip === "displayed") &&
          s.grain === "pattern" &&
          s.hasTopK &&
          (s.source === "pattern-mass" || s.source === "pattern-vocab"),
        "Re-rollup from pattern top-k.",
      ),
    ],
  ),
];

export const pathSpace: StateSpace<PathState> = {
  shape: pathStateSchema,
  transitions,
};

let executable: ReturnType<typeof StateSpaceRepository.makeExecutable<PathState>> | undefined;

export function pathExecutable() {
  if (!executable) executable = StateSpaceRepository.makeExecutable(pathSpace);
  return executable;
}

export function enabledNames(state: PathState, context?: unknown): string[] {
  return pathExecutable()
    .enabled(state, context)
    .map((t) => t.name);
}

export function applyPath(
  state: PathState,
  name: string,
  context?: unknown,
): { ok: true; state: PathState } | { ok: false; error: string; state: PathState } {
  const result = pathExecutable().apply(state, name, context);
  if (result.success) return { ok: true, state: result.state };
  return { ok: false, error: result.error ?? "apply failed", state: result.state };
}

/** Steps shown in the path breadcrumb (commit is implied, not listed). */
export function visiblePathSteps(steps: PathStep[]): { step: PathStep; index: number }[] {
  return steps.map((step, index) => ({ step, index })).filter(({ step }) => step.name !== "commit");
}

/**
 * Truncate through underlying step index (inclusive), replay from initial,
 * and auto-commit when the tip is not yet viewable.
 */
export function revertPathTo(
  steps: PathStep[],
  throughIndex: number,
  catalogRuns: string[],
  runs?: string[],
): { plan: { steps: PathStep[]; runs: string[] }; state: PathState } {
  if (throughIndex < 0 || steps.length === 0) {
    throw new Error("Nothing to revert to.");
  }
  const truncated = steps.slice(0, throughIndex + 1);
  let state = initialPathState;
  for (const step of truncated) {
    const legal = new Set(enabledNames(state, step.params));
    if (!legal.has(step.name)) throw new Error(`Illegal step: ${step.name}`);
    const next = applyPath(state, step.name, step.params);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  if (state.tip !== "committed" && state.tip !== "selected") {
    if (!enabledNames(state).includes("commit")) {
      throw new Error("Path tip is not viewable after truncate.");
    }
    const committed = applyPath(state, "commit");
    if (!committed.ok) throw new Error(committed.error);
    state = committed.state;
  }
  let outRuns: string[];
  if (runs && runs.length > 0) {
    outRuns = runs;
  } else if (state.faceted || state.source === "run-scalars") {
    outRuns = catalogRuns.slice(0, 12);
  } else {
    outRuns = catalogRuns.slice(0, 1);
  }
  if (outRuns.length < 1) throw new Error("No runs available.");
  return { plan: { steps: state.steps, runs: outRuns }, state };
}

/** Replay steps from initial; reject if any step was not legal. */
export function parsePathPlan(
  value: unknown,
  catalogRuns: string[],
): { plan: { steps: PathStep[]; runs: string[] }; state: PathState } {
  if (!value || typeof value !== "object") throw new Error("Expected a path plan.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) throw new Error("Expected steps array.");
  const steps = raw.steps as PathStep[];
  if (steps.some((s) => !s || typeof s.name !== "string")) throw new Error("Invalid step.");
  let state = initialPathState;
  for (const step of steps) {
    const legal = new Set(enabledNames(state, step.params));
    if (!legal.has(step.name)) throw new Error(`Illegal step: ${step.name}`);
    const next = applyPath(state, step.name, step.params);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  if (state.tip !== "committed" && state.tip !== "selected") {
    throw new Error("Path must end committed (or selected after commit).");
  }
  let runs: string[];
  if (Array.isArray(raw.runs) && raw.runs.length > 0) {
    runs = raw.runs as string[];
  } else if (state.faceted || state.source === "run-scalars") {
    runs = catalogRuns.slice(0, 12);
  } else {
    runs = catalogRuns.slice(0, 1);
  }
  if (runs.length < 1 || runs.length > 12) throw new Error("Choose 1–12 runs.");
  if (runs.some((id) => typeof id !== "string" || !/^[\w-]+$/.test(id)))
    throw new Error("Invalid run ID.");
  if (new Set(runs).size !== runs.length) throw new Error("Duplicate run IDs.");
  return { plan: { steps: state.steps, runs }, state };
}

/** Morphism catalog for Jev criteria / UI copy. */
export const morphismCriteria: Record<
  string,
  { what: string; not_for: string; examples: string[] }
> = {
  load_pattern_mass: {
    what: "Load patterns weighted by stored token_count",
    not_for: "Vocabulary counts, edge weights, or run scalars",
    examples: ["Where the count mass lives", "Dominant patterns"],
  },
  load_pattern_vocab: {
    what: "Load patterns as unit vocabulary counts",
    not_for: "Mass-weighted or edge views",
    examples: ["Vocabulary size by pattern", "How many distinct patterns"],
  },
  load_edge_weight: {
    what: "Load patterns by outgoing edge weight",
    not_for: "Token count mass or vocabulary",
    examples: ["Connectivity", "Graph hubs"],
  },
  load_run_scalars: {
    what: "Compare run-level scalars (nodes, mass, edges)",
    not_for: "Pattern-level charts",
    examples: ["How do the runs compare?", "Overview"],
  },
  rollup_length: {
    what: "Group pattern summary by composite length",
    not_for: "After top-k, or on run-scalars/edges",
    examples: ["Length distribution", "How long are patterns"],
  },
  rank_by_length: {
    what: "Order individual patterns by composite length (longest first)",
    not_for: "Length histograms, or after top-k",
    examples: ["What are the longest patterns?", "Longest patterns"],
  },
  partition_by_length: {
    what: "Top patterns within each composite-length partition (not a length histogram)",
    not_for: "After top-k, or mass-by-length rollups",
    examples: ["Most important patterns by length", "Top patterns per length"],
  },
  top_k_5: {
    what: "Keep top 5 bins plus residual",
    not_for: "Run-scalar overview",
    examples: ["Top 5"],
  },
  top_k_10: {
    what: "Keep top 10 bins plus residual",
    not_for: "Run-scalar overview",
    examples: ["Top 10", "Dominant patterns"],
  },
  top_k_20: {
    what: "Keep top 20 bins plus residual",
    not_for: "Run-scalar overview",
    examples: ["Top 20"],
  },
  normalize: {
    what: "Show shares of each run total",
    not_for: "Before aggregation or run-scalars",
    examples: ["Share of run total", "Relative scale"],
  },
  facet_runs: {
    what: "Repeat the view across multiple runs",
    not_for: "Already faceted or run-scalars (always multi)",
    examples: ["Compare runs", "Side by side"],
  },
  commit: {
    what: "Finish the path and render",
    not_for: "Incomplete query with no renderable tip",
    examples: ["Show this view", "Done"],
  },
  select_bin: {
    what: "Focus a chart bin for follow-ups",
    not_for: "Before a rendered view",
    examples: ["Select this pattern"],
  },
  clear_selection: {
    what: "Clear the current bin selection",
    not_for: "When nothing is selected",
    examples: ["Clear selection"],
  },
  open_pattern_detail: {
    what: "Open neighborhood detail for a pattern bin",
    not_for: "Non-pattern bins",
    examples: ["Show neighbors", "Pattern detail"],
  },
  focus_run: {
    what: "Narrow a faceted view to the selected run",
    not_for: "Single-run views",
    examples: ["Just this run"],
  },
  drill_length_patterns: {
    what: "From a length context, show top patterns per length",
    not_for: "Non-length views",
    examples: ["Patterns in this length"],
  },
  re_rollup: {
    what: "Replace pattern top-k with a length rollup",
    not_for: "Views that are not pattern top-k",
    examples: ["Show lengths instead"],
  },
};

/** Domain → codomain catalog (docs/review). Guards remain the runtime gate. */
export type MorphismContract = {
  domain: string;
  codomain: string;
  reload?: boolean;
};

export const morphismContracts: Record<string, MorphismContract> = {
  load_pattern_mass: {
    domain: "query · source none",
    codomain: "summary · pattern · stored-count · pattern-mass",
  },
  load_pattern_vocab: {
    domain: "query · source none",
    codomain: "summary · pattern · vocabulary · pattern-vocab",
  },
  load_edge_weight: {
    domain: "query · source none",
    codomain: "summary · pattern · edge-weight · edge-weight",
  },
  load_run_scalars: {
    domain: "query · source none",
    codomain: "summary · run · stored-count · run-scalars",
  },
  rollup_length: {
    domain: "summary · pattern · !hasTopK · mass|vocab",
    codomain: "summary · length",
  },
  rank_by_length: {
    domain: "summary · pattern · !hasTopK · !rankedByLength · mass|vocab",
    codomain: "summary · pattern · rankedByLength",
  },
  partition_by_length: {
    domain: "summary · pattern · !hasTopK · mass|vocab",
    codomain: "displayed|faceted · pattern-by-length · hasTopK",
    reload: true,
  },
  top_k_5: {
    domain: "summary|faceted · !run · !hasTopK",
    codomain: "displayed|faceted · hasTopK · limit 5",
  },
  top_k_10: {
    domain: "summary|faceted · !run · !hasTopK",
    codomain: "displayed|faceted · hasTopK · limit 10",
  },
  top_k_20: {
    domain: "summary|faceted · !run · !hasTopK",
    codomain: "displayed|faceted · hasTopK · limit 20",
  },
  normalize: {
    domain: "summary|displayed|faceted · !run · !normalized",
    codomain: "displayed|faceted · normalized",
  },
  facet_runs: {
    domain: "summary|displayed · !faceted · !run-scalars",
    codomain: "faceted",
  },
  commit: {
    domain: "displayed|faceted|summary(run|length)",
    codomain: "committed",
  },
  select_bin: {
    domain: "committed|displayed|faceted|selected + selection context",
    codomain: "selected · hasSelection",
  },
  clear_selection: {
    domain: "selected|hasSelection",
    codomain: "committed|faceted · !hasSelection",
  },
  open_pattern_detail: {
    domain: "selected · selectionPatternId > 0",
    codomain: "same · detailRequested",
  },
  focus_run: {
    domain: "faceted · hasSelection · selectionRunId",
    codomain: "committed · !faceted · single run",
  },
  drill_length_patterns: {
    domain: "selected · lengthKey · mass|vocab",
    codomain: "committed · pattern-by-length · hasTopK",
    reload: true,
  },
  re_rollup: {
    domain: "committed|selected|displayed · pattern · hasTopK · mass|vocab",
    codomain: "committed · length · !hasTopK",
    reload: true,
  },
};
