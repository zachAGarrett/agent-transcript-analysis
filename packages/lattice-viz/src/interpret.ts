import type { Bin } from "@workstream/viz-algebra";
import { compileStep } from "./compile";
import { evaluateIR } from "./evaluate-ir";
import { concatIR, emptyIR } from "./execution-ir";
import { IrOpKind, isTopKName, Morphism, TopKBy, topKLimit } from "./ids";
import { SESSION_MORPHISMS } from "./morphisms/transitions";
import type { PathState } from "./path-state";
import type { PathPlan, PathStep } from "./types";

export type InterpretedFacet = {
  bins: Bin[];
  total: number;
  unit: string;
  sql: string;
  overview?: boolean;
  /** Set when the executable plan includes a normalize arrow. */
  normalized?: boolean;
};

type Totals = { mass: number; nodes: number; edgeWeight: number; hubScore: number };

/**
 * Apply path steps via the interpretation functor: compile steps → IR → evaluate.
 * Ad-hoc `top_k_N` (tests / compilePlan limit rewrite) are accepted as IR even when
 * not discrete registry morphisms. Session morphisms are rejected.
 */
export function interpretSummary(
  steps: PathStep[],
  patternBins: Bin[],
  totals: Totals,
): InterpretedFacet {
  let ranked = false;
  let ir = emptyIR();
  for (const step of steps) {
    if (SESSION_MORPHISMS.has(step.name)) {
      throw new Error(`Session morphism not in executable plan: ${step.name}`);
    }
    let fragment = compileStep(step);
    if (step.name === Morphism.rankByLength) ranked = true;
    if (isTopKName(step.name) && ranked) {
      fragment = {
        ops: [
          { op: IrOpKind.topK, limit: topKLimit(step.name, step.params?.limit), by: TopKBy.order },
        ],
      };
    }
    ir = concatIR(ir, fragment);
  }
  return evaluateIR(ir, patternBins, totals);
}

export function pathTitle(state: PathState): { title: string; description: string } {
  const parts = state.steps.map((s) => s.name).filter((n) => n !== Morphism.commit);
  const title = parts.length ? parts.join(" → ") : "Empty path";
  const description = `${state.source} · ${state.grain} · ${state.measure}${state.faceted ? " · faceted" : ""}${state.normalized ? " · normalized" : ""}`;
  return { title, description };
}

export function planNormalized(plan: PathPlan): boolean {
  return plan.steps.some((s) => s.name === Morphism.normalize);
}

export function planLimit(plan: PathPlan): number {
  for (let i = plan.steps.length - 1; i >= 0; i--) {
    const step = plan.steps[i];
    if (!step) continue;
    if (isTopKName(step.name)) {
      return topKLimit(step.name, step.params?.limit);
    }
    if (step.name === Morphism.partitionByLength || step.name === Morphism.drillLengthPatterns) {
      return Number(step.params?.limit) || 10;
    }
  }
  return 10;
}

export function planIsOverview(plan: PathPlan): boolean {
  return plan.steps.some((s) => s.name === Morphism.loadRunScalars);
}
