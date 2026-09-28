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
  applySelectBin,
  clearSessionTip,
  isUserFollowupChip,
  morphismByName,
  morphismContracts,
  morphismCriteria,
  morphismDefs,
  morphismLabel,
  morphismReloads,
  morphismWhat,
} from "./morphisms/registry";
export {
  applyPath,
  enabledNames,
  pathExecutable,
  pathSpace,
} from "./morphisms/transitions";
export type {
  MorphismContract,
  MorphismCriteria,
  MorphismDef,
  MorphismPhase,
} from "./morphisms/types";

export { parsePathPlan, revertPathTo, visiblePathSteps } from "./path-plan";
export {
  autoFollowupAfterSelect,
  planRunsForState,
  restoreSessionTip,
  selectionContextFromState,
  stateIsOverview,
} from "./path-session";
export type { PathState, SelectionContext } from "./path-state";
export {
  initialPathState,
  pathStateSchema,
  SESSION_MORPHISMS,
} from "./path-state";
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
  PatternAtom,
  PatternDetail,
  PatternLabeler,
  PatternLinks,
  PatternNeighbor,
  PatternStep,
  Run,
  TipKind,
  View,
} from "./types";
export { defaultPatternLabeler } from "./types";
