import { defineObjects, objectOf, type SemanticObjectDef } from "@workstream/morphism-space";
import type { PathState } from "../path-state";

/**
 * Canonical projection of PathState into a semantic region.
 * Plan history (`steps`) is excluded — inhabitants of the same region may
 * differ in path length while sharing tip/grain/measure/display/session shape.
 */
export type PathRegionKey =
  | "query"
  | "summary.pattern"
  | "summary.length"
  | "summary.run"
  | "summary.pattern-by-length"
  | "displayed.pattern"
  | "displayed.length"
  | "displayed.pattern-by-length"
  | "faceted.pattern"
  | "faceted.length"
  | "faceted.pattern-by-length"
  | "faceted.summary.pattern"
  | "committed.pattern"
  | "committed.length"
  | "committed.run"
  | "committed.pattern-by-length"
  | "committed.faceted.pattern"
  | "committed.faceted.length"
  | "committed.faceted.pattern-by-length"
  | "selected.pattern"
  | "selected.length"
  | "selected.pattern-by-length"
  | "selected.faceted.pattern"
  | "selected.detail.pattern"
  | "selected.detail.length"
  | "selected.detail.pattern-by-length";

function patternSource(s: PathState): boolean {
  return s.source !== "none" && s.source !== "run-scalars";
}

/** Project PathState → region key (total on reachable tips). */
export function pathRegionKey(state: PathState): PathRegionKey {
  if (state.tip === "query") return "query";

  if (state.tip === "selected") {
    if (state.detailRequested) {
      if (state.grain === "length") return "selected.detail.length";
      if (state.grain === "pattern-by-length") return "selected.detail.pattern-by-length";
      return "selected.detail.pattern";
    }
    if (state.faceted && state.grain === "pattern") return "selected.faceted.pattern";
    if (state.grain === "length") return "selected.length";
    if (state.grain === "pattern-by-length") return "selected.pattern-by-length";
    return "selected.pattern";
  }

  if (state.tip === "committed") {
    if (state.faceted) {
      if (state.grain === "length") return "committed.faceted.length";
      if (state.grain === "pattern-by-length") return "committed.faceted.pattern-by-length";
      return "committed.faceted.pattern";
    }
    if (state.grain === "run") return "committed.run";
    if (state.grain === "length") return "committed.length";
    if (state.grain === "pattern-by-length") return "committed.pattern-by-length";
    return "committed.pattern";
  }

  if (state.tip === "faceted") {
    if (state.grain === "length") return "faceted.length";
    if (state.grain === "pattern-by-length") return "faceted.pattern-by-length";
    return "faceted.pattern";
  }

  if (state.tip === "displayed") {
    if (state.grain === "length") return "displayed.length";
    if (state.grain === "pattern-by-length") return "displayed.pattern-by-length";
    return "displayed.pattern";
  }

  // tip === summary
  if (state.faceted && state.grain === "pattern" && patternSource(state)) {
    return "faceted.summary.pattern";
  }
  if (state.grain === "run" || state.source === "run-scalars") return "summary.run";
  if (state.grain === "length") return "summary.length";
  if (state.grain === "pattern-by-length") return "summary.pattern-by-length";
  return "summary.pattern";
}

function region(key: PathRegionKey): SemanticObjectDef<PathState> {
  return { key, contains: (s) => pathRegionKey(s) === key };
}

export const pathObjects = defineObjects<PathState>()([
  region("query"),
  region("summary.pattern"),
  region("summary.length"),
  region("summary.run"),
  region("summary.pattern-by-length"),
  region("displayed.pattern"),
  region("displayed.length"),
  region("displayed.pattern-by-length"),
  region("faceted.pattern"),
  region("faceted.length"),
  region("faceted.pattern-by-length"),
  region("faceted.summary.pattern"),
  region("committed.pattern"),
  region("committed.length"),
  region("committed.run"),
  region("committed.pattern-by-length"),
  region("committed.faceted.pattern"),
  region("committed.faceted.length"),
  region("committed.faceted.pattern-by-length"),
  region("selected.pattern"),
  region("selected.length"),
  region("selected.pattern-by-length"),
  region("selected.faceted.pattern"),
  region("selected.detail.pattern"),
  region("selected.detail.length"),
  region("selected.detail.pattern-by-length"),
]);

export function classifyPathState(state: PathState): SemanticObjectDef<PathState> | undefined {
  return objectOf(state, pathObjects);
}

/** True when the region is part of an executable construction/display plan tip. */
export function isExecutablePlanRegion(key: PathRegionKey): boolean {
  return (
    key === "query" ||
    key.startsWith("summary.") ||
    key.startsWith("displayed.") ||
    key.startsWith("faceted.") ||
    key.startsWith("committed.")
  );
}
