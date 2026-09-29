import type { CompositionCertificate } from "@workstream/morphism-space";
import { classifyPathState } from "./morphisms/objects";
import { clearSessionTip } from "./morphisms/registry";
import { applyPath, enabledNames, SESSION_MORPHISMS } from "./morphisms/transitions";
import { initialPathState, type PathState } from "./path-state";
import type { PathPlan, PathStep } from "./types";

export type CertifiedPathResult = {
  state: PathState;
  certificate: CompositionCertificate;
};

/**
 * Replay construction/display steps from initial, certifying each hop via
 * semantic region classification. Session morphisms are rejected.
 * Drill carries lengthKey in step params — no manufactured selection tip.
 */
export function composeCertifiedPath(steps: PathStep[]): CertifiedPathResult {
  let state = initialPathState;
  const regions: string[] = [];
  const start = classifyPathState(state)?.key;
  if (start) regions.push(start);
  const stepNames: string[] = [];

  for (const step of steps) {
    if (SESSION_MORPHISMS.has(step.name)) {
      return {
        state,
        certificate: {
          ok: false,
          source: regions[0],
          intermediates: regions.slice(1),
          steps: stepNames,
          error: `Session morphism not allowed in plan: ${step.name}`,
        },
      };
    }
    const legal = new Set(enabledNames(state, step.params));
    if (!legal.has(step.name)) {
      return {
        state,
        certificate: {
          ok: false,
          source: regions[0],
          target: regions[regions.length - 1],
          intermediates: regions.slice(1, -1),
          steps: stepNames,
          error: `Illegal step: ${step.name}`,
        },
      };
    }
    const next = applyPath(state, step.name, step.params);
    if (!next.ok) {
      return {
        state,
        certificate: {
          ok: false,
          source: regions[0],
          target: regions[regions.length - 1],
          intermediates: regions.slice(1, -1),
          steps: stepNames,
          error: next.error,
        },
      };
    }
    stepNames.push(step.name);
    state = next.state;
    const after = classifyPathState(state)?.key;
    if (after) regions.push(after);
  }

  return {
    state,
    certificate: {
      ok: true,
      source: regions[0],
      target: regions[regions.length - 1],
      intermediates: regions.slice(1, -1),
      steps: stepNames,
    },
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
): { plan: PathPlan; state: PathState; certificate: CompositionCertificate } {
  if (throughIndex < 0 || steps.length === 0) {
    throw new Error("Nothing to revert to.");
  }
  const truncated = steps.slice(0, throughIndex + 1);
  let { state, certificate } = composeCertifiedPath(truncated);
  if (!certificate.ok) throw new Error(certificate.error ?? "Illegal path.");
  if (state.tip !== "committed") {
    if (!enabledNames(state).includes("commit")) {
      throw new Error("Path tip is not viewable after truncate.");
    }
    const committed = composeCertifiedPath([...truncated, { name: "commit" }]);
    if (!committed.certificate.ok) throw new Error(committed.certificate.error ?? "commit failed");
    state = committed.state;
    certificate = committed.certificate;
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
  return { plan: { steps: state.steps, runs: outRuns }, state, certificate };
}

/** Replay construction steps from initial; reject session morphisms in the plan. */
export function parsePathPlan(
  value: unknown,
  catalogRuns: string[],
): { plan: PathPlan; state: PathState; certificate: CompositionCertificate } {
  if (!value || typeof value !== "object") throw new Error("Expected a path plan.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.steps)) throw new Error("Expected steps array.");
  const steps = raw.steps as PathStep[];
  if (steps.some((s) => !s || typeof s.name !== "string")) throw new Error("Invalid step.");
  const { state, certificate } = composeCertifiedPath(steps);
  if (!certificate.ok) throw new Error(certificate.error ?? "Illegal path.");
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
  return { plan: { steps: state.steps, runs }, state, certificate };
}
