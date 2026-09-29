/** Const catalogs for tip/path/IR identifiers — wire string values are stable. */

export const Tip = {
  query: "query",
  summary: "summary",
  displayed: "displayed",
  faceted: "faceted",
  selected: "selected",
  committed: "committed",
} as const;
export type TipKind = (typeof Tip)[keyof typeof Tip];
export const TipValues = Object.values(Tip) as TipKind[];

export const Grain = {
  none: "none",
  run: "run",
  pattern: "pattern",
  length: "length",
  patternByLength: "pattern-by-length",
} as const;
export type GrainKind = (typeof Grain)[keyof typeof Grain];
export const GrainValues = Object.values(Grain) as GrainKind[];

export const Measure = {
  none: "none",
  storedCount: "stored-count",
  vocabulary: "vocabulary",
  edgeWeight: "edge-weight",
  hubScore: "hub-score",
  inEdgeWeight: "in-edge-weight",
  decodeSpan: "decode-span",
  decodeFallback: "decode-fallback",
} as const;
export type MeasureKind = (typeof Measure)[keyof typeof Measure];
export const MeasureValues = Object.values(Measure) as MeasureKind[];

/** IR/overview measure — includes run-scalars; excludes PathState `none`. */
export const IrMeasure = {
  storedCount: "stored-count",
  vocabulary: "vocabulary",
  edgeWeight: "edge-weight",
  hubScore: "hub-score",
  inEdgeWeight: "in-edge-weight",
  runScalars: "run-scalars",
  decodeSpan: "decode-span",
  decodeFallback: "decode-fallback",
} as const;
export type IrMeasureKind = (typeof IrMeasure)[keyof typeof IrMeasure];

export const Source = {
  none: "none",
  patternMass: "pattern-mass",
  patternVocab: "pattern-vocab",
  edgeWeight: "edge-weight",
  patternHub: "pattern-hub",
  inEdgeWeight: "in-edge-weight",
  runScalars: "run-scalars",
  decodeSummary: "decode-summary",
} as const;
export type SourceKind = (typeof Source)[keyof typeof Source];
export const SourceValues = Object.values(Source) as SourceKind[];

export type PatternSourceKind = Exclude<SourceKind, "none" | "run-scalars">;

export const Region = {
  query: "query",
  summaryPattern: "summary.pattern",
  summaryLength: "summary.length",
  summaryRun: "summary.run",
  summaryPatternByLength: "summary.pattern-by-length",
  displayedPattern: "displayed.pattern",
  displayedLength: "displayed.length",
  displayedPatternByLength: "displayed.pattern-by-length",
  facetedPattern: "faceted.pattern",
  facetedLength: "faceted.length",
  facetedPatternByLength: "faceted.pattern-by-length",
  facetedSummaryPattern: "faceted.summary.pattern",
  committedPattern: "committed.pattern",
  committedLength: "committed.length",
  committedRun: "committed.run",
  committedPatternByLength: "committed.pattern-by-length",
  committedFacetedPattern: "committed.faceted.pattern",
  committedFacetedLength: "committed.faceted.length",
  committedFacetedPatternByLength: "committed.faceted.pattern-by-length",
  selectedPattern: "selected.pattern",
  selectedLength: "selected.length",
  selectedPatternByLength: "selected.pattern-by-length",
  selectedFacetedPattern: "selected.faceted.pattern",
  selectedDetailPattern: "selected.detail.pattern",
  selectedDetailLength: "selected.detail.length",
  selectedDetailPatternByLength: "selected.detail.pattern-by-length",
} as const;
export type PathRegionKey = (typeof Region)[keyof typeof Region];
export const RegionValues = Object.values(Region) as PathRegionKey[];

export const Morphism = {
  loadPatternMass: "load_pattern_mass",
  loadPatternVocab: "load_pattern_vocab",
  loadEdgeWeight: "load_edge_weight",
  loadHub: "load_hub",
  loadInDegree: "load_in_degree",
  loadRunScalars: "load_run_scalars",
  loadDecodeSpans: "load_decode_spans",
  loadDecodeFallback: "load_decode_fallback",
  rollupLength: "rollup_length",
  rankByLength: "rank_by_length",
  partitionByLength: "partition_by_length",
  topK5: "top_k_5",
  topK10: "top_k_10",
  topK20: "top_k_20",
  normalize: "normalize",
  facetRuns: "facet_runs",
  commit: "commit",
  selectBin: "select_bin",
  clearSelection: "clear_selection",
  openPatternDetail: "open_pattern_detail",
  closePatternDetail: "close_pattern_detail",
  focusRun: "focus_run",
  drillLengthPatterns: "drill_length_patterns",
  reRollup: "re_rollup",
} as const;
export type MorphismName = (typeof Morphism)[keyof typeof Morphism];
export const MorphismValues = Object.values(Morphism) as MorphismName[];

export const TOP_K_PREFIX = "top_k_" as const;

export function topKName(n: number): `top_k_${number}` {
  return `${TOP_K_PREFIX}${n}`;
}

export function isTopKName(name: string): name is `top_k_${number}` {
  return name.startsWith(TOP_K_PREFIX);
}

export function topKLimit(name: string, paramsLimit?: unknown): number {
  return Number(paramsLimit ?? name.replace(TOP_K_PREFIX, "")) || 10;
}

export const IrOpKind = {
  load: "load",
  rollupLength: "rollupLength",
  rankByLength: "rankByLength",
  topK: "topK",
  partitionByLength: "partitionByLength",
  filterLength: "filterLength",
  normalize: "normalize",
  facet: "facet",
  commit: "commit",
  reRollup: "reRollup",
  focusRun: "focusRun",
} as const;
export type IrOpName = (typeof IrOpKind)[keyof typeof IrOpKind];

export const TopKBy = {
  value: "value",
  order: "order",
} as const;
export type TopKByKind = (typeof TopKBy)[keyof typeof TopKBy];

export const ResidualKey = {
  other: "other",
} as const;

export const EffectPath = {
  tip: "tip",
} as const;
