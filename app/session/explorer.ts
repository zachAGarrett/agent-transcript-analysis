import type {
  ExplorationSession,
  PathPlan,
  PathState,
  SelectionContext,
} from "@workstream/lattice-viz";
import {
  applyPath,
  compilePlan,
  emptySession,
  initialPathState,
  presetPaths,
  sessionFromPathState,
  withDisplay,
  withPathState,
  withSelectedRun,
} from "@workstream/lattice-viz";

export type ExplorerSession = ExplorationSession;

export function createExplorerSession(): ExplorerSession {
  return emptySession();
}

export function sessionFromDecision(
  plan: PathPlan,
  state: PathState,
  catalogRuns: string[],
): ExplorerSession {
  let session = sessionFromPathState(state, catalogRuns, plan.runs[0] ?? catalogRuns[0] ?? "");
  session = { ...session, catalogRuns, steps: state.steps };
  if (plan.runs.length > 1 && state.source !== "run-scalars") {
    session = withDisplay(session, { faceted: true });
  }
  if (plan.runs.length === 1 && plan.runs[0]) {
    session = withSelectedRun(session, plan.runs[0]);
  }
  return session;
}

/** Apply a named preset path and materialize an explorer session. */
export function sessionFromPreset(
  presetId: keyof typeof presetPaths,
  catalogRuns: string[],
): ExplorerSession {
  const steps = presetPaths[presetId];
  if (!steps?.length) throw new Error(`Unknown preset: ${String(presetId)}`);
  let state = initialPathState;
  for (const step of steps) {
    const next = applyPath(state, step.name, step.params);
    if (!next.ok) throw new Error(next.error);
    state = next.state;
  }
  const runs =
    state.faceted || state.source === "run-scalars"
      ? catalogRuns.slice(0, 12)
      : catalogRuns.slice(0, 1);
  return sessionFromDecision({ steps: state.steps, runs }, state, catalogRuns);
}

export function sessionAfterFollowup(
  prev: ExplorerSession,
  plan: PathPlan,
  state: PathState,
): ExplorerSession {
  return withPathState(prev, state, plan.runs);
}

export function sessionAfterRevert(
  prev: ExplorerSession,
  plan: PathPlan,
  state: PathState,
): ExplorerSession {
  return withPathState(prev, state, plan.runs);
}

export function patchDisplay(
  session: ExplorerSession,
  patch: Partial<ExplorerSession["display"]>,
): ExplorerSession {
  return withDisplay(session, patch);
}

export function selectRun(session: ExplorerSession, runId: string): ExplorerSession {
  return withSelectedRun(session, runId);
}

export function effectivePlan(session: ExplorerSession): PathPlan {
  return compilePlan(session);
}

export function selectionOf(session: ExplorerSession): SelectionContext | null {
  return session.selection;
}
