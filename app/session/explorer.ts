import type {
  ExplorationSession,
  PathPlan,
  PathState,
  SelectionContext,
} from "@workstream/lattice-viz";
import {
  compilePlan,
  emptySession,
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
