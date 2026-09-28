import { clearSessionTip } from "./morphisms/registry";
import { applyPath, enabledNames } from "./morphisms/transitions";
import { initialPathState, type PathState, SESSION_MORPHISMS } from "./path-state";
import type { PathPlan, PathStep } from "./types";

/**
 * Construction replay: drill stores lengthKey on the step (session select is not in
 * the plan), so hydrate a transient selection tip for legality + effect.
 */
function tipForConstructionStep(state: PathState, step: PathStep): PathState {
  if (step.name !== "drill_length_patterns") return state;
  const lengthKey = String(step.params?.lengthKey ?? "");
  if (!lengthKey || lengthKey === "other") return state;
  return {
    ...state,
    tip: "selected",
    hasSelection: true,
    selectionLengthKey: lengthKey,
    selectionBinKey: lengthKey,
    selectionRunId: state.selectionRunId || "_",
  };
}

/** Steps shown in the path breadcrumb (commit + session morphisms omitted). */
export function visiblePathSteps(steps: PathStep[]): { step: PathStep; index: number }[] {
  return steps
    .map((step, index) => ({ step, index }))
    .filter(({ step }) => step.name !== "commit" && !SESSION_MORPHISMS.has(step.name));
}

/**
 * Truncate construction plan through index (inclusive), replay from initial,
 * auto-commit when needed, and clear session tip.
 */
export function revertPathTo(
  steps: PathStep[],
  throughIndex: number,
  catalogRuns: string[],
  runs?: string[],
): { plan: PathPlan; state: PathState } {
  if (throughIndex < 0 || steps.length === 0) {
    throw new Error("Nothing to revert to.");
  }
  const truncated = steps.slice(0, throughIndex + 1);
  let state = initialPathState;
  for (const step of truncated) {
    if (SESSION_MORPHISMS.has(step.name)) {
      throw new Error(`Session morphism not allowed in plan: ${step.name}`);
    }
    const tip = tipForConstructionStep(state, step);
    const legal = new Set(enabledNames(tip, step.params));
    if (!legal.has(step.name)) throw new Error(`Illegal step: ${step.name}`);
    const next = applyPath(tip, step.name, step.params);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  if (state.tip !== "committed") {
    if (!enabledNames(state).includes("commit")) {
      throw new Error("Path tip is not viewable after truncate.");
    }
    const committed = applyPath(state, "commit");
    if (!committed.ok) throw new Error(committed.error);
    state = committed.state;
  }
  state = clearSessionTip(state);
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

/** Replay construction steps from initial; reject session morphisms in the plan. */
export function parsePathPlan(
  value: unknown,
  catalogRuns: string[],
): { plan: PathPlan; state: PathState } {
  if (!value || typeof value !== "object") throw new Error("Expected a path plan.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) throw new Error("Expected steps array.");
  const steps = raw.steps as PathStep[];
  if (steps.some((s) => !s || typeof s.name !== "string")) throw new Error("Invalid step.");
  let state = initialPathState;
  for (const step of steps) {
    if (SESSION_MORPHISMS.has(step.name)) {
      throw new Error(`Session morphism not allowed in plan: ${step.name}`);
    }
    const tip = tipForConstructionStep(state, step);
    const legal = new Set(enabledNames(tip, step.params));
    if (!legal.has(step.name)) throw new Error(`Illegal step: ${step.name}`);
    const next = applyPath(tip, step.name, step.params);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  if (state.tip !== "committed") {
    throw new Error("Path must end committed.");
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
