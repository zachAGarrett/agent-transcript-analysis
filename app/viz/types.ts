export type Bin = {
  key: string;
  label: string;
  value: number;
  id?: number;
  token?: string;
};

export type DisplaySpec = {
  limit: number;
  normalized: boolean;
  faceted: boolean;
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
  /** True when runtime events.jsonl exists for timeline scrubber. */
  hasEvents?: boolean;
};

export type Facet = { run: Run; bins: Bin[]; total: number; unit: string; sql: string };

export type View = {
  query: import("./chart-query").ChartQuery;
  facets: Facet[];
  generatedAt: string;
  cacheHit: boolean;
};

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
