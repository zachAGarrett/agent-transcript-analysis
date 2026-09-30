export type { Arrow, Bin, Summary } from "@workstream/viz-algebra";
export {
  compose,
  merge,
  normalize,
  rollup,
  topWithRemainder,
} from "@workstream/viz-algebra";

export type {
  FacetChartModel,
  FacetChartRow,
  OverviewMetricModel,
} from "./charts";
export {
  facetChartModel,
  facetChartModels,
  formatChartValue,
  isResidual,
  lengthKeyForBin,
  overviewMetricModels,
  sharedDomainMax,
  stamp,
} from "./charts";
export { compileIdentity, compilePath, compileStep } from "./compile";
export { evaluateIR } from "./evaluate-ir";
export type { ExecutionIR, IrOp, MeasureKind } from "./execution-ir";
export { concatIR, emptyIR, irEquals } from "./execution-ir";
export type {
  GrainKind,
  IrMeasureKind,
  IrOpName,
  MeasureKind as PathMeasureKind,
  MorphismName,
  PathRegionKey,
  PatternSourceKind,
  SourceKind,
  TipKind,
  TopKByKind,
} from "./ids";
export {
  Grain,
  GrainValues,
  IrMeasure,
  IrOpKind,
  isTopKName,
  Measure,
  MeasureValues,
  Morphism,
  MorphismValues,
  Region,
  RegionValues,
  ResidualKey,
  Source,
  SourceValues,
  Tip,
  TipValues,
  TOP_K_PREFIX,
  TopKBy,
  topKLimit,
  topKName,
} from "./ids";
export type { InterpretedFacet } from "./interpret";
export {
  interpretSummary,
  pathTitle,
  planIsOverview,
  planLimit,
  planNormalized,
} from "./interpret";
export { patternDisplayLabel, setPatternLabeler } from "./labels";
export {
  classifyPathState,
  isExecutablePlanRegion,
  pathObjects,
  pathRegionKey,
} from "./morphisms/objects";
export {
  applySelectBin,
  clearSessionTip,
  morphismDefs,
} from "./morphisms/registry";
export {
  applyPath,
  enabledNames,
  isUserFollowupChip,
  morphismByName,
  morphismContracts,
  morphismCriteria,
  morphismLabel,
  morphismReloads,
  morphismWhat,
  pathExecutable,
  pathMorphismSpace,
  pathSpace,
  SESSION_MORPHISMS,
} from "./morphisms/transitions";
export type {
  MorphismContract,
  MorphismCriteria,
  MorphismDef,
  MorphismPhase,
} from "./morphisms/types";
export { canLowerToSql, optimizeIR } from "./optimize";
export type { CertifiedPathResult } from "./path-plan";
export {
  composeCertifiedPath,
  parsePathPlan,
  revertPathTo,
  visiblePathSteps,
} from "./path-plan";
export {
  autoFollowupAfterSelect,
  planRunsForState,
  restoreSessionTip,
  selectionContextFromState,
  stateIsOverview,
} from "./path-session";
export type { PathState, SelectionContext, TimelineChartKind } from "./path-state";
export { initialPathState, pathStateSchema } from "./path-state";
export { patternLengthKey, patternsByLength } from "./pattern-length";
export { explorerStarterPresets, presetPaths } from "./presets";

export type {
  DisplaySpec,
  ExplorationSession,
} from "./session/exploration";
export {
  compilePlan,
  displayFromPathState,
  emptySession,
  sessionFromPathState,
  withDisplay,
  withPathState,
  withSelectedRun,
} from "./session/exploration";

export type {
  Facet,
  PathPlan,
  PathStep,
  PathStepName,
  PatternAtom,
  PatternDetail,
  PatternLabeler,
  PatternLinks,
  PatternNeighbor,
  PatternStep,
  Run,
  View,
} from "./types";
export { defaultPatternLabeler } from "./types";
