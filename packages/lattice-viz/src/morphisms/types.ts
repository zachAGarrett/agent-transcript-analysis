import type { Bin, Summary } from "@workstream/viz-algebra";
import type { PathState } from "../path-state";
import type { PathStep } from "../types";

export type MorphismPhase = "construction" | "display" | "session";

export type MorphismCriteria = {
  label: string;
  what: string;
  not_for: string;
  examples: string[];
};

export type MorphismContract = {
  domain: string;
  codomain: string;
  /** Chart data must be reloaded after this morphism. */
  reload?: boolean;
  /**
   * When false, hide from the follow-up chip row (still legal in enabled /
   * auto-follow). Defaults to true for transitions that appear in enabled.
   */
  userFollowup?: boolean;
};

/** Mutable accumulator for plan → bins interpretation. */
export type InterpretCtx = {
  source: PathState["source"];
  measure: PathState["measure"];
  grain: PathState["grain"];
  limit: number;
  hasTopK: boolean;
  rankedByLength: boolean;
  sql: string;
  summary: Summary;
  displayTotal: number;
  patternBins: Bin[];
  totals: { mass: number; nodes: number; edgeWeight: number; hubScore: number };
};

export type MorphismDef = {
  name: string;
  phase: MorphismPhase;
  criteria: MorphismCriteria;
  contract: MorphismContract;
  guard: (state: PathState, context?: unknown) => boolean;
  guardMessage: string;
  effect: (state: PathState, context?: unknown) => PathState;
  /** Optional interpret handler; display/session morphisms often omit this. */
  interpret?: (ctx: InterpretCtx, step: PathStep) => InterpretCtx;
};
