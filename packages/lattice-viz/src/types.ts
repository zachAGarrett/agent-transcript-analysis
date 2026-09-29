import type { Bin } from "@workstream/viz-algebra";
import type { MorphismName } from "./ids";

export type { TipKind } from "./ids";

/** Registered morphism name, or ad-hoc top_k_N from display compilePlan / tests. */
export type PathStepName = MorphismName | `top_k_${number}`;

export type PathStep = { name: PathStepName; params?: Record<string, unknown> };

/** Serializable morphism path — the render plan. */
export type PathPlan = {
  steps: PathStep[];
  runs: string[];
};

export type Run = {
  id: string;
  version: string;
  nodes: number;
  mass: number;
  edges: number;
  edgeWeight: number;
  maxWeight: number;
  hubScore: number;
  scored: number;
  fixture: string | null;
  train: number | null;
  heldOut: number | null;
  warning: string | null;
};

export type Facet = { run: Run; bins: Bin[]; total: number; unit: string; sql: string };
export type View = { plan: PathPlan; facets: Facet[]; generatedAt: string; cacheHit: boolean };

export type PatternNeighbor = { id: number; token: string; weight: number; prob?: number };
export type PatternLinks = {
  rows: PatternNeighbor[];
  total?: number;
  count?: number;
};

export type PatternAtom = { axis: string; value: string };
export type PatternStep = { atoms: PatternAtom[]; brief: string; full: string };

export type PatternDetail = {
  pattern: { id: number; token: string; token_count: number; hub_score: number };
  steps: PatternStep[] | null;
  outgoing: PatternLinks;
  incoming: PatternLinks;
};

/** Injected pattern labeler — adapters supply fixture-aware decoding. */
export type PatternLabeler = (bin: { id?: number; key: string; token?: string }) => string;

export const defaultPatternLabeler: PatternLabeler = (bin) => `Pattern #${bin.id ?? bin.key}`;
