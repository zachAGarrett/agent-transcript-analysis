import type { PathPlan, PathState } from "@workstream/lattice-viz";

/** Mirror of api/jev metrics — kept local so the browser never imports the Jev client. */
export type JevCallMetrics = {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};

export type DecideStep = { id: string; label: string };

export type DecideResponse = {
  plan: PathPlan | null;
  state: PathState | null;
  source: "jev" | "rules";
  steps: DecideStep[];
  metrics?: JevCallMetrics;
  enabledFollowups?: string[];
};

export type DecideHooks = {
  onStep?: (step: DecideStep) => void | Promise<void>;
};
