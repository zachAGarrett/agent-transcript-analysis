import type {
  MorphismContract,
  MorphismCriteria,
  MorphismDefinition,
  MorphismPhase,
} from "@workstream/morphism-space";
import type { Bin, Summary } from "@workstream/viz-algebra";
import type { PathState } from "../path-state";
import type { PathStep } from "../types";

export type { MorphismContract, MorphismCriteria, MorphismPhase };

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

/** Lattice morphism definition: PathState effects + optional InterpretCtx handlers. */
export type MorphismDef<TName extends string = string> = MorphismDefinition<
  PathState,
  unknown,
  InterpretCtx,
  PathStep,
  TName
>;
