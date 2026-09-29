import { Morphism, Source } from "./ids";
import { applySelectBin } from "./morphisms/registry";
import type { PathState, SelectionContext } from "./path-state";

/** Restore session tip after replaying a construction plan. */
export function restoreSessionTip(
  state: PathState,
  selection?: SelectionContext | null,
  detailRequested?: boolean,
): PathState {
  let next = state;
  if (selection?.runId && selection.binKey) {
    next = applySelectBin(next, selection);
  }
  if (detailRequested && next.hasSelection && next.selectionPatternId > 0) {
    next = { ...next, detailRequested: true };
  }
  return next;
}

/** Prefer a single automatic continuation after select_bin when the tip enables it. */
const AUTO_AFTER_SELECT = [Morphism.drillLengthPatterns, Morphism.openPatternDetail] as const;

export function autoFollowupAfterSelect(
  enabled: string[],
): (typeof AUTO_AFTER_SELECT)[number] | null {
  for (const name of AUTO_AFTER_SELECT) {
    if (enabled.includes(name)) return name;
  }
  return null;
}

export function selectionContextFromState(state: PathState): SelectionContext | undefined {
  if (!state.hasSelection) return undefined;
  return {
    runId: state.selectionRunId,
    binKey: state.selectionBinKey,
    patternId: state.selectionPatternId || undefined,
    lengthKey: state.selectionLengthKey || undefined,
  };
}

/** Narrow plan.runs after focus_run (!faceted + selection still held). */
export function planRunsForState(state: PathState, sessionRuns: string[]): string[] {
  if (!state.faceted && state.hasSelection && state.selectionRunId) {
    return [state.selectionRunId];
  }
  return sessionRuns;
}

export function stateIsOverview(state: PathState | null | undefined): boolean {
  return state?.source === Source.runScalars;
}
