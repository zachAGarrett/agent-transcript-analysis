import { defineMorphisms, Phase } from "@workstream/morphism-space";
import { rollup, type Summary, topWithRemainder } from "@workstream/viz-algebra";
import {
  Grain,
  Measure,
  Morphism,
  type PathRegionKey,
  Region,
  ResidualKey,
  Source,
  Tip,
  topKLimit,
} from "../ids";
import { patternDisplayLabel } from "../labels";
import type { PathState, SelectionContext } from "../path-state";
import { patternLengthKey, patternsByLength } from "../pattern-length";
import type { PathStep, PathStepName } from "../types";
import type { InterpretCtx, MorphismDef } from "./types";

/** Pattern-level sources (excludes query tip and run overview). */
function isPatternSource(s: PathState): boolean {
  return s.source !== Source.none && s.source !== Source.runScalars;
}

function totalForMeasure(measure: PathState["measure"], totals: InterpretCtx["totals"]): number {
  if (measure === Measure.vocabulary) return totals.nodes;
  if (measure === Measure.edgeWeight || measure === Measure.inEdgeWeight) return totals.edgeWeight;
  if (measure === Measure.hubScore) return totals.hubScore;
  return totals.mass;
}

/** Shallow merge into path state (no plan step). */
export function patchState(state: PathState, patch: Partial<PathState>): PathState {
  return { ...state, ...patch };
}

/** Append a construction/display step, optionally merging a shallow state patch. */
export function appendStep(
  state: PathState,
  name: PathStepName,
  patch: Partial<PathState> = {},
  params?: Record<string, unknown>,
): PathState {
  const step: PathStep = params ? { name, params } : { name };
  return { ...state, ...patch, steps: [...state.steps, step] };
}

/** Tip/session-only patch (never appends a construction step). */
export function tipPatch(state: PathState, patch: Partial<PathState>): PathState {
  return patchState(state, patch);
}

export function clearSessionTip(state: PathState): PathState {
  return tipPatch(state, {
    tip: state.tip === Tip.selected ? (state.faceted ? Tip.faceted : Tip.committed) : state.tip,
    hasSelection: false,
    selectionRunId: "",
    selectionBinKey: "",
    selectionPatternId: 0,
    selectionLengthKey: "",
    detailRequested: false,
  });
}

/** Tip-only selection update (no plan lineage). */
export function applySelectBin(state: PathState, sel: SelectionContext): PathState {
  return tipPatch(state, {
    tip: Tip.selected,
    hasSelection: true,
    selectionRunId: sel.runId,
    selectionBinKey: sel.binKey,
    selectionPatternId: sel.patternId ?? 0,
    selectionLengthKey: sel.lengthKey ?? "",
    detailRequested: false,
  });
}

function lengthKeyFromContext(context: unknown, fallback: string): string {
  if (context && typeof context === "object" && "lengthKey" in context) {
    const key = String((context as { lengthKey?: unknown }).lengthKey ?? "");
    if (key) return key;
  }
  return fallback;
}

/** Keep current bin order; residual conserves total (no value re-sort). */
function topInOrder(
  bins: InterpretCtx["summary"]["bins"],
  total: number,
  limit: number,
): InterpretCtx["summary"]["bins"] {
  const top = bins.slice(0, limit);
  const remainder = total - top.reduce((sum, bin) => sum + bin.value, 0);
  if (remainder < -1e-7) throw new Error("Displayed bins exceed the source total.");
  return remainder > 0
    ? [...top, { key: ResidualKey.other, label: "All other patterns", value: remainder }]
    : top;
}

function rankBinsByLength(bins: InterpretCtx["summary"]["bins"]) {
  return [...bins]
    .sort(
      (a, b) =>
        Number(patternLengthKey(b)) - Number(patternLengthKey(a)) ||
        b.value - a.value ||
        a.key.localeCompare(b.key),
    )
    .map((bin) => ({
      ...bin,
      label: `${patternLengthKey(bin)} · ${patternDisplayLabel(bin)}`,
    }));
}

function loadDef<N extends string>(
  name: N,
  criteria: MorphismDef["criteria"],
  contract: MorphismDef["contract"],
  patch: Pick<PathState, "grain" | "measure" | "source">,
  sql: string,
): MorphismDef<N> {
  const target: PathRegionKey =
    patch.grain === Grain.run || patch.source === Source.runScalars
      ? Region.summaryRun
      : Region.summaryPattern;
  return {
    name,
    phase: Phase.construction,
    criteria,
    contract: { ...contract, source: Region.query, target },
    available: {
      when: (s) => s.tip === Tip.query && s.source === Source.none,
      otherwise: "Need query tip.",
    },
    effect: (s) => appendStep(s, name as PathStepName, { tip: Tip.summary, ...patch }),
    interpret: (ctx) => ({
      ...ctx,
      source: patch.source,
      measure: patch.measure,
      grain: patch.grain,
      sql,
    }),
  };
}

const topK = <N extends 5 | 10 | 20>(n: N): MorphismDef<`top_k_${N}`> => ({
  name: `top_k_${n}`,
  phase: Phase.display,
  criteria: {
    label: `Top ${n}`,
    what: `Keep top ${n} bins plus residual`,
    not_for: "Run-scalar overview",
    examples: n === 10 ? ["Top 10", "Dominant patterns"] : [`Top ${n}`],
  },
  contract: {
    domain: "summary|faceted · !run · !hasTopK",
    codomain: `displayed|faceted · hasTopK · limit ${n}`,
  },
  available: {
    when: (s) =>
      (s.tip === Tip.summary || (s.tip === Tip.faceted && !s.hasTopK)) &&
      s.grain !== Grain.run &&
      s.source !== Source.runScalars &&
      !s.hasTopK,
    otherwise: "Top-k needs aggregate summary (not run-scalars).",
  },
  effect: (s) =>
    appendStep(
      s,
      `top_k_${n}`,
      {
        tip: s.faceted ? Tip.faceted : Tip.displayed,
        hasTopK: true,
        limit: n,
      },
      { limit: n },
    ),
  interpret: (ctx, step) => {
    const limit = topKLimit(step.name, step.params?.limit);
    const total = totalForMeasure(ctx.measure, ctx.totals);
    let summary = ctx.summary;
    if (ctx.rankedByLength && summary.grain === Grain.pattern) {
      summary = { ...summary, bins: topInOrder(summary.bins, total, limit) };
    } else if (summary.grain === Grain.patternByLength) {
      /* already residualized per length */
    } else {
      summary = {
        ...summary,
        bins: topWithRemainder(summary.bins, total, limit),
      };
    }
    return {
      ...ctx,
      summary,
      limit,
      hasTopK: true,
      sql: `${ctx.sql}\n-- top_k_${limit}`,
    };
  },
});

export const morphismDefs = defineMorphisms<PathState, unknown, InterpretCtx, PathStep>()([
  loadDef(
    Morphism.loadPatternMass,
    {
      label: "Pattern mass",
      what: "Load patterns weighted by stored token_count (overlapping emission mass)",
      not_for: "Vocabulary presence, edge weights, hub scores, or run scalars",
      examples: ["Where the count mass lives", "Dominant patterns", "Most frequent patterns"],
    },
    {
      domain: "query · source none",
      codomain: "summary · pattern · stored-count · pattern-mass",
    },
    { grain: Grain.pattern, measure: Measure.storedCount, source: Source.patternMass },
    "SELECT id, token, token_count value FROM nodes",
  ),
  loadDef(
    Morphism.loadPatternVocab,
    {
      label: "Pattern vocabulary",
      what: "Load patterns as unit presence (each pattern counts as 1)",
      not_for: "Mass-weighted, edge, or hub views",
      examples: ["Distinct patterns only", "Vocabulary without mass", "Rare but present patterns"],
    },
    {
      domain: "query · source none",
      codomain: "summary · pattern · vocabulary · pattern-vocab",
    },
    { grain: Grain.pattern, measure: Measure.vocabulary, source: Source.patternVocab },
    "SELECT id, token, 1 value FROM nodes",
  ),
  loadDef(
    Morphism.loadEdgeWeight,
    {
      label: "Outgoing edge weight",
      what: "Load patterns by sum of outgoing transition weights (branching / junctions)",
      not_for: "Incoming sinks, hub_score centrality, or token mass",
      examples: ["Outgoing connectivity", "Patterns that branch onward", "Reusable junctions"],
    },
    {
      domain: "query · source none",
      codomain: "summary · pattern · edge-weight · edge-weight",
    },
    { grain: Grain.pattern, measure: Measure.edgeWeight, source: Source.edgeWeight },
    "SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n LEFT JOIN (SELECT from_id, sum(weight) value FROM edges GROUP BY from_id) e ON e.from_id = n.id",
  ),
  loadDef(
    Morphism.loadHub,
    {
      label: "Hub score",
      what: "Load patterns by hub_score (tkn DegreeScorer: log1p outgoing weight)",
      not_for: "Raw edge weight sums, inbound sinks, or frequency mass",
      examples: ["Central patterns", "Hub patterns", "Rare but well-connected"],
    },
    {
      domain: "query · source none",
      codomain: "summary · pattern · hub-score · pattern-hub",
    },
    { grain: Grain.pattern, measure: Measure.hubScore, source: Source.patternHub },
    "SELECT id, token, hub_score value FROM nodes",
  ),
  loadDef(
    Morphism.loadInDegree,
    {
      label: "Incoming edge weight",
      what: "Load patterns by sum of incoming transition weights (sinks / attractors)",
      not_for: "Outgoing junctions, hub_score, or token mass",
      examples: [
        "Incoming connectivity",
        "Patterns everything converges into",
        "Sinks and attractors",
      ],
    },
    {
      domain: "query · source none",
      codomain: "summary · pattern · in-edge-weight · in-edge-weight",
    },
    { grain: Grain.pattern, measure: Measure.inEdgeWeight, source: Source.inEdgeWeight },
    "SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n LEFT JOIN (SELECT to_id, sum(weight) value FROM edges GROUP BY to_id) e ON e.to_id = n.id",
  ),
  loadDef(
    Morphism.loadRunScalars,
    {
      label: "Run overview",
      what: "Compare run-level scalars (nodes, mass, edges)",
      not_for: "Pattern-level charts",
      examples: ["How do the runs compare?", "Overview"],
    },
    {
      domain: "query · source none",
      codomain: "summary · run · stored-count · run-scalars",
    },
    { grain: Grain.run, measure: Measure.storedCount, source: Source.runScalars },
    "run scalars",
  ),
  {
    name: Morphism.rollupLength,
    phase: Phase.construction,
    criteria: {
      label: "By length",
      what: "Group pattern summary by composite length",
      not_for: "After top-k, or on run-scalars",
      examples: ["Length distribution", "How long are patterns"],
    },
    contract: {
      domain: "summary · pattern · !hasTopK",
      codomain: "summary · length",
    },
    available: {
      when: (s) =>
        s.tip === Tip.summary && s.grain === Grain.pattern && !s.hasTopK && isPatternSource(s),
      otherwise: "Rollup needs pattern summary before top-k.",
    },
    effect: (s) =>
      appendStep(s, Morphism.rollupLength, {
        tip: Tip.summary,
        grain: Grain.length,
        rankedByLength: false,
      }),
    interpret: (ctx) => ({
      ...ctx,
      summary: rollup(ctx.summary, "length", patternLengthKey),
      grain: Grain.length,
      rankedByLength: false,
      sql: `${ctx.sql}\n-- rollup_length`,
    }),
  },
  {
    name: Morphism.rankByLength,
    phase: Phase.construction,
    criteria: {
      label: "Longest first",
      what: "Order individual patterns by composite length (longest first)",
      not_for: "Length histograms, or after top-k",
      examples: ["What are the longest patterns?", "Longest patterns"],
    },
    contract: {
      domain: "summary · pattern · !hasTopK · !rankedByLength",
      codomain: "summary · pattern · rankedByLength",
    },
    available: {
      when: (s) =>
        s.tip === Tip.summary &&
        s.grain === Grain.pattern &&
        !s.hasTopK &&
        !s.rankedByLength &&
        isPatternSource(s),
      otherwise: "Rank by length needs pattern summary before top-k.",
    },
    effect: (s) =>
      appendStep(s, Morphism.rankByLength, {
        tip: Tip.summary,
        grain: Grain.pattern,
        rankedByLength: true,
      }),
    interpret: (ctx) => ({
      ...ctx,
      summary: { ...ctx.summary, bins: rankBinsByLength(ctx.summary.bins) },
      grain: Grain.pattern,
      rankedByLength: true,
      sql: `${ctx.sql}\n-- rank_by_length`,
    }),
  },
  {
    name: Morphism.partitionByLength,
    phase: Phase.construction,
    criteria: {
      label: "Top per length",
      what: "Top patterns within each composite-length partition (not a length histogram)",
      not_for: "After top-k, or mass-by-length rollups",
      examples: ["Most important patterns by length", "Top patterns per length"],
    },
    contract: {
      domain: "summary · pattern · !hasTopK",
      codomain: "displayed|faceted · pattern-by-length · hasTopK",
      reload: true,
    },
    available: {
      when: (s) =>
        s.tip === Tip.summary && s.grain === Grain.pattern && !s.hasTopK && isPatternSource(s),
      otherwise: "Partition by length needs pattern summary before top-k.",
    },
    effect: (s) =>
      appendStep(
        s,
        Morphism.partitionByLength,
        {
          tip: s.faceted ? Tip.faceted : Tip.displayed,
          grain: Grain.patternByLength,
          hasTopK: true,
          rankedByLength: false,
        },
        { limit: s.limit },
      ),
    interpret: (ctx, step) => {
      const n = Number(step.params?.limit ?? ctx.limit) || 10;
      const binValue = (bin: (typeof ctx.patternBins)[number]) =>
        ctx.measure === Measure.vocabulary ? 1 : bin.value;
      return {
        ...ctx,
        limit: n,
        summary: patternsByLength(
          {
            scope: "run",
            grain: Grain.pattern,
            measure: ctx.summary.measure,
            bins: ctx.patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
          },
          n,
        ),
        grain: Grain.patternByLength,
        hasTopK: true,
        rankedByLength: false,
        sql: `${ctx.sql}\n-- partition_by_length limit=${n}`,
      };
    },
  },
  topK(5),
  topK(10),
  topK(20),
  {
    name: Morphism.normalize,
    phase: Phase.display,
    criteria: {
      label: "Share of total",
      what: "Show shares of each run total",
      not_for: "Before aggregation or run-scalars",
      examples: ["Share of run total", "Relative scale"],
    },
    contract: {
      domain: "summary|displayed|faceted · !run · !normalized",
      codomain: "displayed|faceted · normalized",
    },
    available: {
      when: (s) =>
        (s.tip === Tip.summary || s.tip === Tip.displayed || s.tip === Tip.faceted) &&
        s.grain !== Grain.run &&
        !s.normalized &&
        s.source !== Source.runScalars,
      otherwise: "Normalize after aggregation; once only.",
    },
    effect: (s) =>
      appendStep(s, Morphism.normalize, {
        tip: s.faceted ? Tip.faceted : Tip.displayed,
        normalized: true,
      }),
  },
  {
    name: Morphism.facetRuns,
    phase: Phase.display,
    criteria: {
      label: "Compare runs",
      what: "Repeat the view across multiple runs",
      not_for: "Already faceted or run-scalars (always multi)",
      examples: ["Compare runs", "Side by side"],
    },
    contract: {
      domain: "summary|displayed · !faceted · !run-scalars",
      codomain: "faceted",
    },
    available: {
      when: (s) =>
        (s.tip === Tip.summary || s.tip === Tip.displayed) &&
        !s.faceted &&
        s.source !== Source.runScalars,
      otherwise: "Facet once from summary/displayed.",
    },
    effect: (s) => appendStep(s, Morphism.facetRuns, { tip: Tip.faceted, faceted: true }),
  },
  {
    name: Morphism.commit,
    phase: Phase.construction,
    criteria: {
      label: "Commit",
      what: "Finish the path and render",
      not_for: "Incomplete query with no renderable tip",
      examples: ["Show this view", "Done"],
    },
    contract: {
      domain: "displayed|faceted|summary(run|length)",
      codomain: "committed",
      userFollowup: false,
    },
    available: {
      when: (s) =>
        s.tip === Tip.displayed ||
        s.tip === Tip.faceted ||
        (s.tip === Tip.summary && (s.grain === Grain.run || s.grain === Grain.length)),
      otherwise: "Commit from renderable tip.",
    },
    effect: (s) => appendStep(s, Morphism.commit, { tip: Tip.committed }),
  },
  {
    name: Morphism.selectBin,
    phase: Phase.session,
    criteria: {
      label: "Select bin",
      what: "Focus a chart bin for follow-ups",
      not_for: "Before a rendered view",
      examples: ["Select this pattern"],
    },
    contract: {
      domain: "committed|displayed|faceted|selected + selection context",
      codomain: "selected · hasSelection",
      userFollowup: false,
    },
    available: {
      when: (s) =>
        s.tip === Tip.committed ||
        s.tip === Tip.displayed ||
        s.tip === Tip.faceted ||
        s.tip === Tip.selected,
      otherwise: "Select from a rendered view.",
    },
    effect: (s, context) => {
      const sel = context as SelectionContext | undefined;
      if (!sel?.runId || !sel.binKey) throw new Error("Selection context required.");
      return applySelectBin(s, sel);
    },
  },
  {
    name: Morphism.clearSelection,
    phase: Phase.session,
    criteria: {
      label: "Clear selection",
      what: "Clear the current bin selection",
      not_for: "When nothing is selected",
      examples: ["Clear selection"],
    },
    contract: {
      domain: "selected|hasSelection",
      codomain: "committed|faceted · !hasSelection",
    },
    available: {
      when: (s) => s.hasSelection || s.tip === Tip.selected,
      otherwise: "No selection.",
    },
    effect: (s) => clearSessionTip(s),
  },
  {
    name: Morphism.openPatternDetail,
    phase: Phase.session,
    criteria: {
      label: "Pattern detail",
      what: "Open neighborhood detail for a pattern bin",
      not_for: "Non-pattern bins",
      examples: ["Show neighbors", "Pattern detail"],
    },
    contract: {
      domain: "selected · selectionPatternId > 0",
      codomain: "same · detailRequested",
      userFollowup: false,
    },
    available: {
      when: (s) => (s.tip === Tip.selected || s.hasSelection) && s.selectionPatternId > 0,
      otherwise: "Need a pattern selection.",
    },
    effect: (s) => tipPatch(s, { detailRequested: true }),
  },
  {
    name: Morphism.closePatternDetail,
    phase: Phase.session,
    criteria: {
      label: "Close detail",
      what: "Close the pattern neighborhood dialog",
      not_for: "When detail is not open",
      examples: ["Close detail"],
    },
    contract: {
      domain: "detailRequested",
      codomain: "same · !detailRequested",
      userFollowup: false,
    },
    available: {
      when: (s) => s.detailRequested,
      otherwise: "No pattern detail open.",
    },
    effect: (s) => tipPatch(s, { detailRequested: false }),
  },
  {
    name: Morphism.focusRun,
    phase: Phase.construction,
    criteria: {
      label: "This run",
      what: "Narrow a faceted view to the selected run",
      not_for: "Single-run views",
      examples: ["Just this run"],
    },
    contract: {
      domain: "faceted · hasSelection · selectionRunId",
      codomain: "committed · !faceted · single run",
      reload: true,
    },
    available: {
      when: (s) => s.faceted && s.hasSelection && s.selectionRunId.length > 0,
      otherwise: "Focus needs faceted view + run selection.",
    },
    effect: (s) =>
      appendStep(
        s,
        Morphism.focusRun,
        {
          faceted: false,
          tip: Tip.committed,
        },
        { runId: s.selectionRunId },
      ),
  },
  {
    name: Morphism.drillLengthPatterns,
    phase: Phase.construction,
    criteria: {
      label: "Top per length",
      what: "Show top patterns for the selected length",
      not_for: "Non-length views",
      examples: ["Patterns in this length"],
    },
    contract: {
      domain: "selected · grain length · lengthKey",
      codomain: "committed · pattern-by-length · hasTopK",
      reload: true,
    },
    available: {
      when: (s, context) => {
        if (!isPatternSource(s) || s.grain !== Grain.length) return false;
        const key = lengthKeyFromContext(context, s.selectionLengthKey);
        if (!key || key === ResidualKey.other) return false;
        // Live tip selection, or plan replay with lengthKey in step params.
        if (s.tip === Tip.selected || s.hasSelection) return true;
        return (
          (s.tip === Tip.committed || s.tip === Tip.summary || s.tip === Tip.displayed) &&
          !!context &&
          typeof context === "object" &&
          "lengthKey" in context
        );
      },
      otherwise: "Drill needs a length-bin selection on a pattern source.",
    },
    effect: (s, context) => {
      const lengthKey = lengthKeyFromContext(context, s.selectionLengthKey);
      if (!lengthKey || lengthKey === ResidualKey.other)
        throw new Error("Drill needs a length key.");
      const limit =
        Number(
          context && typeof context === "object" && "limit" in context
            ? (context as { limit?: unknown }).limit
            : s.limit,
        ) || s.limit;
      return appendStep(
        clearSessionTip(s),
        Morphism.drillLengthPatterns,
        {
          tip: Tip.committed,
          grain: Grain.patternByLength,
          hasTopK: true,
          rankedByLength: false,
          limit,
        },
        { limit, lengthKey },
      );
    },
    interpret: (ctx, step) => {
      const n = Number(step.params?.limit ?? ctx.limit) || 10;
      const lengthKey = String(step.params?.lengthKey ?? "");
      if (!lengthKey) throw new Error("drill_length_patterns requires lengthKey.");
      const binValue = (bin: (typeof ctx.patternBins)[number]) =>
        ctx.measure === Measure.vocabulary ? 1 : bin.value;
      const cohort = ctx.patternBins
        .map((bin) => ({ ...bin, value: binValue(bin) }))
        .filter((bin) => patternLengthKey(bin) === lengthKey);
      const displayTotal = cohort.reduce((sum, bin) => sum + bin.value, 0);
      const summary: Summary = {
        scope: "run",
        grain: Grain.patternByLength,
        measure: ctx.summary.measure,
        bins: topWithRemainder(cohort, displayTotal, n).map((bin) => {
          if (bin.key === ResidualKey.other) {
            return {
              ...bin,
              key: `${lengthKey}:other`,
              label: `All other length-${lengthKey} patterns`,
            };
          }
          const lengthTag = lengthKey === "32" ? "32+" : lengthKey;
          return {
            ...bin,
            key: `${lengthKey}:${String(bin.id ?? bin.key)}`,
            label: `${lengthTag} · ${patternDisplayLabel(bin)}`,
          };
        }),
      };
      return {
        ...ctx,
        limit: n,
        displayTotal,
        summary,
        grain: Grain.patternByLength,
        hasTopK: true,
        rankedByLength: false,
        sql: `${ctx.sql}\n-- drill_length_patterns length=${lengthKey} limit=${n}`,
      };
    },
  },
  {
    name: Morphism.reRollup,
    phase: Phase.construction,
    criteria: {
      label: "By length",
      what: "Replace pattern top-k with a length rollup",
      not_for: "Views that are not pattern top-k",
      examples: ["Show lengths instead"],
    },
    contract: {
      domain: "committed|selected|displayed · pattern · hasTopK",
      codomain: "committed · length · !hasTopK",
      reload: true,
    },
    available: {
      when: (s) =>
        (s.tip === Tip.committed || s.tip === Tip.selected || s.tip === Tip.displayed) &&
        s.grain === Grain.pattern &&
        s.hasTopK &&
        isPatternSource(s),
      otherwise: "Re-rollup from pattern top-k.",
    },
    effect: (s) =>
      appendStep(clearSessionTip(s), Morphism.reRollup, {
        tip: Tip.committed,
        grain: Grain.length,
        hasTopK: false,
        rankedByLength: false,
        normalized: false,
      }),
    interpret: (ctx) => {
      const binValue = (bin: (typeof ctx.patternBins)[number]) =>
        ctx.measure === Measure.vocabulary ? 1 : bin.value;
      return {
        ...ctx,
        summary: rollup(
          {
            scope: "run",
            grain: Grain.pattern,
            measure: ctx.summary.measure,
            bins: ctx.patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
          },
          "length",
          patternLengthKey,
        ),
        grain: Grain.length,
        hasTopK: false,
        rankedByLength: false,
        sql: `${ctx.sql}\n-- re_rollup`,
      };
    },
  },
]);
