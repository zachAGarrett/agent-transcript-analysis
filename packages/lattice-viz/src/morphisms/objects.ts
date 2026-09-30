import { defineObjects, objectOf, type SemanticObjectDef } from "@workstream/morphism-space";
import { Grain, type PathRegionKey, Region, Source, Tip } from "../ids";
import type { PathState } from "../path-state";

export type { PathRegionKey } from "../ids";

/**
 * Canonical projection of PathState into a semantic region.
 * Plan history (`steps`) is excluded — inhabitants of the same region may
 * differ in path length while sharing tip/grain/measure/display/session shape.
 */
function patternSource(s: PathState): boolean {
  return s.source !== Source.none && s.source !== Source.runScalars;
}

/** Project PathState → region key (total on reachable tips). */
export function pathRegionKey(state: PathState): PathRegionKey {
  if (state.tip === Tip.timeline || state.timelineRequested) return Region.timelineScrubber;
  if (state.tip === Tip.query) return Region.query;

  if (state.tip === Tip.selected) {
    if (state.detailRequested) {
      if (state.grain === Grain.length) return Region.selectedDetailLength;
      if (state.grain === Grain.patternByLength) return Region.selectedDetailPatternByLength;
      return Region.selectedDetailPattern;
    }
    if (state.faceted && state.grain === Grain.pattern) return Region.selectedFacetedPattern;
    if (state.grain === Grain.length) return Region.selectedLength;
    if (state.grain === Grain.patternByLength) return Region.selectedPatternByLength;
    return Region.selectedPattern;
  }

  if (state.tip === Tip.committed) {
    if (state.faceted) {
      if (state.grain === Grain.length) return Region.committedFacetedLength;
      if (state.grain === Grain.patternByLength) return Region.committedFacetedPatternByLength;
      return Region.committedFacetedPattern;
    }
    if (state.grain === Grain.run) return Region.committedRun;
    if (state.grain === Grain.length) return Region.committedLength;
    if (state.grain === Grain.patternByLength) return Region.committedPatternByLength;
    return Region.committedPattern;
  }

  if (state.tip === Tip.faceted) {
    if (state.grain === Grain.length) return Region.facetedLength;
    if (state.grain === Grain.patternByLength) return Region.facetedPatternByLength;
    return Region.facetedPattern;
  }

  if (state.tip === Tip.displayed) {
    if (state.grain === Grain.length) return Region.displayedLength;
    if (state.grain === Grain.patternByLength) return Region.displayedPatternByLength;
    return Region.displayedPattern;
  }

  // tip === summary
  if (state.faceted && state.grain === Grain.pattern && patternSource(state)) {
    return Region.facetedSummaryPattern;
  }
  if (state.grain === Grain.run || state.source === Source.runScalars) return Region.summaryRun;
  if (state.grain === Grain.length) return Region.summaryLength;
  if (state.grain === Grain.patternByLength) return Region.summaryPatternByLength;
  return Region.summaryPattern;
}

function region(key: PathRegionKey): SemanticObjectDef<PathState> {
  return { key, contains: (s) => pathRegionKey(s) === key };
}

export const pathObjects = defineObjects<PathState>()([
  region(Region.query),
  region(Region.summaryPattern),
  region(Region.summaryLength),
  region(Region.summaryRun),
  region(Region.summaryPatternByLength),
  region(Region.displayedPattern),
  region(Region.displayedLength),
  region(Region.displayedPatternByLength),
  region(Region.facetedPattern),
  region(Region.facetedLength),
  region(Region.facetedPatternByLength),
  region(Region.facetedSummaryPattern),
  region(Region.committedPattern),
  region(Region.committedLength),
  region(Region.committedRun),
  region(Region.committedPatternByLength),
  region(Region.committedFacetedPattern),
  region(Region.committedFacetedLength),
  region(Region.committedFacetedPatternByLength),
  region(Region.selectedPattern),
  region(Region.selectedLength),
  region(Region.selectedPatternByLength),
  region(Region.selectedFacetedPattern),
  region(Region.selectedDetailPattern),
  region(Region.selectedDetailLength),
  region(Region.selectedDetailPatternByLength),
  region(Region.timelineScrubber),
]);

export function classifyPathState(state: PathState): SemanticObjectDef<PathState> | undefined {
  return objectOf(state, pathObjects);
}

/** True when the region is part of an executable construction/display plan tip. */
export function isExecutablePlanRegion(key: PathRegionKey): boolean {
  return (
    key === Region.query ||
    key.startsWith("summary.") ||
    key.startsWith("displayed.") ||
    key.startsWith("faceted.") ||
    key.startsWith("committed.")
  );
}
