import type { PathPlan, PathState, PathStep, PathStepName } from "@workstream/lattice-viz";
import {
  applyPath,
  enabledNames,
  initialPathState,
  Morphism,
  morphismCriteria,
  morphismLabel,
  Source,
  Tip,
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
    state.faceted || state.source === Source.runScalars
      ? catalogRuns.slice(0, 12)
      : catalogRuns.slice(0, 1);
  if (runs.length < 1) throw new Error("No runs available.");
  return { steps: state.steps, runs };
}

/** Forced pick only: commit when legal, else unique enabled name. */
function forcedPick(legal: string[]): string | null {
  if (legal.includes(Morphism.commit)) return Morphism.commit;
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

  if (
    has(legal, Morphism.openTimelineScrubber) &&
    /\b(timeline|scrub|replay|live decode|events\.jsonl)\b/.test(q)
  ) {
    return Morphism.openTimelineScrubber;
  }

  if (
    has(legal, Morphism.showTimelineGraph) &&
    /\b(graph|transition|predict|next.?pattern)\b/.test(q)
  ) {
    return Morphism.showTimelineGraph;
  }

  if (has(legal, Morphism.showTimelineAccuracy) && /\b(accuracy|hit@|hit rate)\b/.test(q)) {
    return Morphism.showTimelineAccuracy;
  }

  if (has(legal, Morphism.showTimelineLength) && /\b(length|span|pattern length)\b/.test(q)) {
    return Morphism.showTimelineLength;
  }

  const loads = legal.filter((n) => n.startsWith("load_"));
  if (loads.length > 1) {
    if (
      has(legal, Morphism.loadHub) &&
      /\b(hub|central|centrality|well[- ]?connected|pagerank)\b/.test(q)
    ) {
      return Morphism.loadHub;
    }
    if (
      has(legal, Morphism.loadInDegree) &&
      /\b(incoming|in[- ]?degree|sink|attractor|converge)\b/.test(q)
    ) {
      return Morphism.loadInDegree;
    }
    if (
      has(legal, Morphism.loadEdgeWeight) &&
      /\b(outgoing|out[- ]?degree|connect|connectivity|branch|junction)\b/.test(q)
    ) {
      return Morphism.loadEdgeWeight;
    }
    if (has(legal, Morphism.loadPatternVocab) && /\b(vocab|vocabulary|distinct|unique)\b/.test(q)) {
      return Morphism.loadPatternVocab;
    }
    if (has(legal, Morphism.loadRunScalars) && /\b(overview|compare runs|run scalars?)\b/.test(q)) {
      return Morphism.loadRunScalars;
    }
    // Default pattern load when the question looks chart-like or mentions patterns/length.
    if (
      has(legal, Morphism.loadPatternMass) &&
      /\b(lengths?|longest|mass|frequent|dominant|top|patterns?|show|chart|view)\b/.test(q)
    ) {
      return Morphism.loadPatternMass;
    }
  }

  if (has(legal, Morphism.rankByLength) && /\blongest\b/.test(q)) return Morphism.rankByLength;
  if (
    has(legal, Morphism.partitionByLength) &&
    /\b(per length|top per|patterns by length)\b/.test(q)
  ) {
    return Morphism.partitionByLength;
  }
  if (
    has(legal, Morphism.rollupLength) &&
    /\b(lengths?|how long|complexity|distribution)\b/.test(q)
  ) {
    return Morphism.rollupLength;
  }

  if (
    has(legal, Morphism.topK10) &&
    /\b(top|dominant|frequent|mass|hub|incoming|outgoing|vocab|connect|patterns?|longest)\b/.test(q)
  ) {
    return Morphism.topK10;
  }

  return null;
}

/** Rules policy: forced picks plus keyword heuristics for competing loads/steps. */
export async function proposePathRules(
  question: string,
  catalogRuns: string[],
  hooks?: DecideHooks,
  runHasEvents = false,
): Promise<DecideResponse> {
  let state = { ...initialPathState, runHasEvents };
  const trace: DecideStep[] = [];
  for (let i = 0; i < MAX_LOOP; i++) {
    if (state.tip === Tip.committed || state.tip === Tip.timeline) break;
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
    if (pick === Morphism.commit || pick === Morphism.openTimelineScrubber) break;
  }
  if (state.tip !== Tip.committed && state.tip !== Tip.timeline) {
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
  runHasEvents = false,
): Promise<DecideResponse> {
  let state = { ...initialPathState, runHasEvents };
  const trace: DecideStep[] = [];
  let metrics = emptyMetrics();
  const history: PathStep[] = [];

  for (let i = 0; i < MAX_LOOP; i++) {
    if (state.tip === Tip.committed || state.tip === Tip.timeline) break;
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
      return proposePathRules(question, catalogRuns, undefined, runHasEvents);
    }
    const next = applyPath(state, picked);
    if (!next.ok) return proposePathRules(question, catalogRuns, undefined, runHasEvents);
    state = next.state;
    history.push({ name: picked as PathStepName });
    const step = { id: picked, label: morphismLabel(picked) };
    trace.push(step);
    await hooks?.onStep?.(step);
    if (picked === Morphism.commit || picked === Morphism.openTimelineScrubber) break;
  }

  if (state.tip !== Tip.committed && state.tip !== Tip.timeline) {
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
