import type { DisplaySpec } from "@workstream/lattice-viz";
import type { ExplorerViewId } from "@/app/views";

/** Lightweight explorer UI state — no morphism tip machine. */
export type ExplorerSession = {
  view: ExplorerViewId;
  catalogRuns: string[];
  selectedRunId: string;
  display: DisplaySpec;
  runHasEvents: boolean;
};

export function createExplorerSession(): ExplorerSession {
  return {
    view: "lattice",
    catalogRuns: [],
    selectedRunId: "",
    display: { limit: 10, normalized: false, faceted: false },
    runHasEvents: false,
  };
}

export function patchDisplay(
  session: ExplorerSession,
  patch: Partial<DisplaySpec>,
): ExplorerSession {
  return { ...session, display: { ...session.display, ...patch } };
}

export function selectRun(session: ExplorerSession, runId: string): ExplorerSession {
  return {
    ...session,
    selectedRunId: runId,
    display: { ...session.display, faceted: false },
  };
}

export function setView(session: ExplorerSession, view: ExplorerViewId): ExplorerSession {
  return { ...session, view };
}
