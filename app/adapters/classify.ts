import type { PathPlan, PathState, PathStep } from "@workstream/lattice-viz";
import {
  applyPath,
  enabledNames,
  initialPathState,
  morphismCriteria,
  morphismLabel,
} from "@workstream/lattice-viz";
import { type JevCallMetrics, resolveChoiceLabel, systemOneChoice } from "../../api/jev";
import type { DecideHooks, DecideResponse, DecideStep } from "./decide-types";

export type { DecideHooks, DecideResponse, DecideStep } from "./decide-types";

const MAX_LOOP = 12;

function emptyMetrics(): JevCallMetrics {
  return { latencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };
}

function addMetrics(a: JevCallMetrics, b: JevCallMetrics): JevCallMetrics {
  return {
    latencyMs: a.latencyMs + b.latencyMs,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedUsd: a.estimatedUsd + b.estimatedUsd,
  };
}

function materialize(state: PathState, catalogRuns: string[]): PathPlan {
  const runs =
    state.faceted || state.source === "run-scalars"
      ? catalogRuns.slice(0, 12)
      : catalogRuns.slice(0, 1);
  if (runs.length < 1) throw new Error("No runs available.");
  return { steps: state.steps, runs };
}

/** Forced pick only: commit when legal, else unique enabled name. */
function forcedPick(legal: string[]): string | null {
  if (legal.includes("commit")) return "commit";
  if (legal.length === 1) return legal[0] ?? null;
  return null;
}

function has(legal: string[], name: string): boolean {
  return legal.includes(name);
}

/** Keyword heuristic among competing legal morphisms (loads + common construction). */
export function rulesPick(question: string, legal: string[]): string | null {
  const forced = forcedPick(legal);
  if (forced) return forced;

  const q = question.toLowerCase();
  const loads = legal.filter((n) => n.startsWith("load_"));
  if (loads.length > 1) {
    if (
      has(legal, "load_hub") &&
      /\b(hub|central|centrality|well[- ]?connected|pagerank)\b/.test(q)
    ) {
      return "load_hub";
    }
    if (
      has(legal, "load_in_degree") &&
      /\b(incoming|in[- ]?degree|sink|attractor|converge)\b/.test(q)
    ) {
      return "load_in_degree";
    }
    if (
      has(legal, "load_edge_weight") &&
      /\b(outgoing|out[- ]?degree|connect|connectivity|branch|junction)\b/.test(q)
    ) {
      return "load_edge_weight";
    }
    if (has(legal, "load_pattern_vocab") && /\b(vocab|vocabulary|distinct|unique)\b/.test(q)) {
      return "load_pattern_vocab";
    }
    if (has(legal, "load_run_scalars") && /\b(overview|compare runs|run scalars?)\b/.test(q)) {
      return "load_run_scalars";
    }
    // Default pattern load when the question looks chart-like or mentions patterns/length.
    if (
      has(legal, "load_pattern_mass") &&
      /\b(lengths?|longest|mass|frequent|dominant|top|patterns?|show|chart|view)\b/.test(q)
    ) {
      return "load_pattern_mass";
    }
  }

  if (has(legal, "rank_by_length") && /\blongest\b/.test(q)) return "rank_by_length";
  if (has(legal, "partition_by_length") && /\b(per length|top per|patterns by length)\b/.test(q)) {
    return "partition_by_length";
  }
  if (has(legal, "rollup_length") && /\b(lengths?|how long|complexity|distribution)\b/.test(q)) {
    return "rollup_length";
  }

  if (
    has(legal, "top_k_10") &&
    /\b(top|dominant|frequent|mass|hub|incoming|outgoing|vocab|connect|patterns?|longest)\b/.test(q)
  ) {
    return "top_k_10";
  }

  return null;
}

/** Rules policy: forced picks plus keyword heuristics for competing loads/steps. */
export async function proposePathRules(
  question: string,
  catalogRuns: string[],
  hooks?: DecideHooks,
): Promise<DecideResponse> {
  let state = initialPathState;
  const trace: DecideStep[] = [];
  for (let i = 0; i < MAX_LOOP; i++) {
    if (state.tip === "committed") break;
    const legal = enabledNames(state);
    if (legal.length === 0) break;
    const pick = rulesPick(question, legal);
    if (!pick) break;
    const next = applyPath(state, pick);
    if (!next.ok) break;
    state = next.state;
    const step = { id: pick, label: morphismLabel(pick) };
    trace.push(step);
    await hooks?.onStep?.(step);
    if (pick === "commit") break;
  }
  if (state.tip !== "committed") {
    return { plan: null, state: null, source: "rules", steps: trace };
  }
  const plan = materialize(state, catalogRuns);
  return {
    plan,
    state,
    source: "rules",
    steps: trace,
    enabledFollowups: enabledNames(state),
  };
}

/** Jev policy: Choice among enabled morphism names only. */
export async function proposePathWithJev(
  question: string,
  catalogRuns: string[],
  hooks?: DecideHooks,
): Promise<DecideResponse> {
  let state = initialPathState;
  const trace: DecideStep[] = [];
  let metrics = emptyMetrics();
  const history: PathStep[] = [];

  for (let i = 0; i < MAX_LOOP; i++) {
    if (state.tip === "committed") break;
    const legal = enabledNames(state);
    if (legal.length === 0) break;

    const criteria: Record<string, { what: string; not_for: string; examples: string[] }> = {};
    for (const name of legal) {
      const entry = morphismCriteria[name];
      criteria[name] = entry
        ? { what: entry.what, not_for: entry.not_for, examples: entry.examples }
        : {
            what: name,
            not_for: "Other morphisms",
            examples: [name],
          };
    }

    const { answer, metrics: stepMetrics } = await systemOneChoice({
      state: {
        role: "explorer",
        question,
        tip: state.tip,
        source: state.source,
        grain: state.grain,
        measure: state.measure,
        path: history.map((s) => s.name),
        legal,
      },
      questionId: "next",
      instructions: {
        question: "Which legal morphism extends this chart path next?",
        focus: "Pick only from the provided labels; prefer commit when the view is ready.",
      },
      criteria,
    });
    metrics = addMetrics(metrics, stepMetrics);
    const picked = resolveChoiceLabel(answer, legal);
    if (!legal.includes(picked)) {
      return proposePathRules(question, catalogRuns);
    }
    const next = applyPath(state, picked);
    if (!next.ok) return proposePathRules(question, catalogRuns);
    state = next.state;
    history.push({ name: picked });
    const step = { id: picked, label: morphismLabel(picked) };
    trace.push(step);
    await hooks?.onStep?.(step);
    if (picked === "commit") break;
  }

  if (state.tip !== "committed") {
    return { plan: null, state: null, source: "jev", steps: trace, metrics };
  }
  return {
    plan: materialize(state, catalogRuns),
    state,
    source: "jev",
    steps: trace,
    metrics,
    enabledFollowups: enabledNames(state),
  };
}
