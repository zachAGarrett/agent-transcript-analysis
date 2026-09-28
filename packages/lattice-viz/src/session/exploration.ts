import type { PathState, SelectionContext } from "../path-state";
import { initialPathState } from "../path-state";
import type { PathPlan, PathStep } from "../types";

/** Reversible display knobs compiled into the executable plan. */
export type DisplaySpec = {
  limit: number;
  normalized: boolean;
  faceted: boolean;
};

/**
 * Canonical exploration session — single source for construction, display,
 * run scope, and transient selection. PathState tip + PathPlan are derived.
 */
export type ExplorationSession = {
  /** Construction + post-commit construction lineage (may include display morphisms from path walk). */
  steps: PathStep[];
  /** Full catalog of run ids available for faceting (never narrowed by focus_run). */
  catalogRuns: string[];
  selectedRunId: string;
  display: DisplaySpec;
  selection: SelectionContext | null;
  detailRequested: boolean;
  /** Tip machine snapshot (grain/source/flags/selection mirrored for enabledNames). */
  pathState: PathState;
};

export function displayFromPathState(state: PathState): DisplaySpec {
  return {
    limit: state.limit,
    normalized: state.normalized,
    faceted: state.faceted,
  };
}

export function sessionFromPathState(
  state: PathState,
  catalogRuns: string[],
  selectedRunId?: string,
): ExplorationSession {
  return {
    steps: state.steps,
    catalogRuns,
    selectedRunId: selectedRunId ?? catalogRuns[0] ?? "",
    display: displayFromPathState(state),
    selection: state.hasSelection
      ? {
          runId: state.selectionRunId,
          binKey: state.selectionBinKey,
          patternId: state.selectionPatternId || undefined,
          lengthKey: state.selectionLengthKey || undefined,
        }
      : null,
    detailRequested: state.detailRequested,
    pathState: state,
  };
}

export function emptySession(): ExplorationSession {
  return sessionFromPathState(initialPathState, []);
}

/**
 * Compile an executable PathPlan from the session.
 * Display morphisms (top-k limit, normalize, facet) are applied as if chosen
 * before commit — the single boundary replacing ad-hoc plan surgery.
 */
export function compilePlan(session: ExplorationSession): PathPlan {
  const overview = session.steps.some((s) => s.name === "load_run_scalars");
  let steps = session.steps.map((s) =>
    s.name.startsWith("top_k_")
      ? { name: `top_k_${session.display.limit}`, params: { limit: session.display.limit } }
      : { ...s },
  );

  const hasNorm = steps.some((s) => s.name === "normalize");
  if (session.display.normalized && !hasNorm && !overview) {
    const i = steps.findIndex((s) => s.name === "commit");
    steps.splice(i >= 0 ? i : steps.length, 0, { name: "normalize" });
  }
  if (!session.display.normalized && hasNorm) {
    steps = steps.filter((s) => s.name !== "normalize");
  }

  const wantCompare = session.display.faceted || overview;
  const hasFacet = steps.some((s) => s.name === "facet_runs");
  if (wantCompare && !hasFacet && !overview) {
    const i = steps.findIndex((s) => s.name === "commit");
    steps.splice(i >= 0 ? i : steps.length, 0, { name: "facet_runs" });
  }
  if (!wantCompare && hasFacet) {
    steps = steps.filter((s) => s.name !== "facet_runs");
  }

  const catalogRuns = session.catalogRuns;
  const runs = wantCompare
    ? catalogRuns.slice(0, 12)
    : ([session.selectedRunId || catalogRuns[0]].filter(Boolean) as string[]);

  return { steps, runs };
}

/** Patch display knobs and mirror them onto pathState for tip consistency. */
export function withDisplay(
  session: ExplorationSession,
  patch: Partial<DisplaySpec>,
): ExplorationSession {
  const display = { ...session.display, ...patch };
  return {
    ...session,
    display,
    pathState: {
      ...session.pathState,
      limit: display.limit,
      normalized: display.normalized,
      faceted: display.faceted,
    },
  };
}

export function withSelectedRun(
  session: ExplorationSession,
  selectedRunId: string,
): ExplorationSession {
  return withDisplay({ ...session, selectedRunId }, { faceted: false });
}

export function withPathState(
  session: ExplorationSession,
  pathState: PathState,
  /** Optional queried runs from a follow-up (e.g. focus_run); does not replace catalog. */
  queriedRuns?: string[],
): ExplorationSession {
  let selectedRunId = session.selectedRunId;
  if (!pathState.faceted && queriedRuns?.length === 1 && queriedRuns[0]) {
    selectedRunId = queriedRuns[0];
  } else if (pathState.hasSelection && pathState.selectionRunId) {
    selectedRunId = pathState.selectionRunId;
  }
  return {
    ...sessionFromPathState(pathState, session.catalogRuns, selectedRunId),
    catalogRuns: session.catalogRuns,
  };
}
