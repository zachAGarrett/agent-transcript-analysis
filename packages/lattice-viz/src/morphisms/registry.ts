import { rollup, type Summary, topWithRemainder } from "@workstream/viz-algebra";
import { patternDisplayLabel } from "../labels";
import type { PathState, SelectionContext } from "../path-state";
import { patternLengthKey, patternsByLength } from "../pattern-length";
import type { PathStep } from "../types";
import type { InterpretCtx, MorphismDef } from "./types";

/** Pattern-level sources (excludes query tip and run overview). */
function isPatternSource(s: PathState): boolean {
  return s.source !== "none" && s.source !== "run-scalars";
}

function totalForMeasure(measure: PathState["measure"], totals: InterpretCtx["totals"]): number {
  if (measure === "vocabulary") return totals.nodes;
  if (measure === "edge-weight" || measure === "in-edge-weight") return totals.edgeWeight;
  if (measure === "hub-score") return totals.hubScore;
  return totals.mass;
}

/** Append a construction/display step to the render plan. */
function append(state: PathState, name: string, params?: Record<string, unknown>): PathState {
  const step: PathStep = params ? { name, params } : { name };
  return { ...state, steps: [...state.steps, step] };
}

export function clearSessionTip(state: PathState): PathState {
  return {
    ...state,
    tip: state.tip === "selected" ? (state.faceted ? "faceted" : "committed") : state.tip,
    hasSelection: false,
    selectionRunId: "",
    selectionBinKey: "",
    selectionPatternId: 0,
    selectionLengthKey: "",
    detailRequested: false,
  };
}

/** Tip-only selection update (no plan lineage). */
export function applySelectBin(state: PathState, sel: SelectionContext): PathState {
  return {
    ...state,
    tip: "selected",
    hasSelection: true,
    selectionRunId: sel.runId,
    selectionBinKey: sel.binKey,
    selectionPatternId: sel.patternId ?? 0,
    selectionLengthKey: sel.lengthKey ?? "",
    detailRequested: false,
  };
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
    ? [...top, { key: "other", label: "All other patterns", value: remainder }]
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

function loadDef(
  name: string,
  criteria: MorphismDef["criteria"],
  contract: MorphismDef["contract"],
  patch: Pick<PathState, "grain" | "measure" | "source">,
  sql: string,
): MorphismDef {
  return {
    name,
    phase: "construction",
    criteria,
    contract,
    guard: (s) => s.tip === "query" && s.source === "none",
    guardMessage: "Need query tip.",
    effect: (s) => append({ ...s, tip: "summary", ...patch }, name),
    interpret: (ctx) => ({
      ...ctx,
      source: patch.source,
      measure: patch.measure,
      grain: patch.grain,
      sql,
    }),
  };
}

const topK = (n: 5 | 10 | 20): MorphismDef => ({
  name: `top_k_${n}`,
  phase: "display",
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
  guard: (s) =>
    (s.tip === "summary" || (s.tip === "faceted" && !s.hasTopK)) &&
    s.grain !== "run" &&
    s.source !== "run-scalars" &&
    !s.hasTopK,
  guardMessage: "Top-k needs aggregate summary (not run-scalars).",
  effect: (s) =>
    append(
      {
        ...s,
        tip: s.faceted ? "faceted" : "displayed",
        hasTopK: true,
        limit: n,
      },
      `top_k_${n}`,
      { limit: n },
    ),
  interpret: (ctx, step) => {
    const limit = Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
    const total = totalForMeasure(ctx.measure, ctx.totals);
    let summary = ctx.summary;
    if (ctx.rankedByLength && summary.grain === "pattern") {
      summary = { ...summary, bins: topInOrder(summary.bins, total, limit) };
    } else if (summary.grain === "pattern-by-length") {
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

export const morphismDefs: MorphismDef[] = [
  loadDef(
    "load_pattern_mass",
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
    { grain: "pattern", measure: "stored-count", source: "pattern-mass" },
    "SELECT id, token, token_count value FROM nodes",
  ),
  loadDef(
    "load_pattern_vocab",
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
    { grain: "pattern", measure: "vocabulary", source: "pattern-vocab" },
    "SELECT id, token, 1 value FROM nodes",
  ),
  loadDef(
    "load_edge_weight",
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
    { grain: "pattern", measure: "edge-weight", source: "edge-weight" },
    "SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n LEFT JOIN (SELECT from_id, sum(weight) value FROM edges GROUP BY from_id) e ON e.from_id = n.id",
  ),
  loadDef(
    "load_hub",
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
    { grain: "pattern", measure: "hub-score", source: "pattern-hub" },
    "SELECT id, token, hub_score value FROM nodes",
  ),
  loadDef(
    "load_in_degree",
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
    { grain: "pattern", measure: "in-edge-weight", source: "in-edge-weight" },
    "SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n LEFT JOIN (SELECT to_id, sum(weight) value FROM edges GROUP BY to_id) e ON e.to_id = n.id",
  ),
  loadDef(
    "load_run_scalars",
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
    { grain: "run", measure: "stored-count", source: "run-scalars" },
    "run scalars",
  ),
  {
    name: "rollup_length",
    phase: "construction",
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
    guard: (s) => s.tip === "summary" && s.grain === "pattern" && !s.hasTopK && isPatternSource(s),
    guardMessage: "Rollup needs pattern summary before top-k.",
    effect: (s) =>
      append({ ...s, tip: "summary", grain: "length", rankedByLength: false }, "rollup_length"),
    interpret: (ctx) => ({
      ...ctx,
      summary: rollup(ctx.summary, "length", patternLengthKey),
      grain: "length",
      rankedByLength: false,
      sql: `${ctx.sql}\n-- rollup_length`,
    }),
  },
  {
    name: "rank_by_length",
    phase: "construction",
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
    guard: (s) =>
      s.tip === "summary" &&
      s.grain === "pattern" &&
      !s.hasTopK &&
      !s.rankedByLength &&
      isPatternSource(s),
    guardMessage: "Rank by length needs pattern summary before top-k.",
    effect: (s) =>
      append({ ...s, tip: "summary", grain: "pattern", rankedByLength: true }, "rank_by_length"),
    interpret: (ctx) => ({
      ...ctx,
      summary: { ...ctx.summary, bins: rankBinsByLength(ctx.summary.bins) },
      grain: "pattern",
      rankedByLength: true,
      sql: `${ctx.sql}\n-- rank_by_length`,
    }),
  },
  {
    name: "partition_by_length",
    phase: "construction",
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
    guard: (s) => s.tip === "summary" && s.grain === "pattern" && !s.hasTopK && isPatternSource(s),
    guardMessage: "Partition by length needs pattern summary before top-k.",
    effect: (s) =>
      append(
        {
          ...s,
          tip: s.faceted ? "faceted" : "displayed",
          grain: "pattern-by-length",
          hasTopK: true,
          rankedByLength: false,
        },
        "partition_by_length",
        { limit: s.limit },
      ),
    interpret: (ctx, step) => {
      const n = Number(step.params?.limit ?? ctx.limit) || 10;
      const binValue = (bin: (typeof ctx.patternBins)[number]) =>
        ctx.measure === "vocabulary" ? 1 : bin.value;
      return {
        ...ctx,
        limit: n,
        summary: patternsByLength(
          {
            scope: "run",
            grain: "pattern",
            measure: ctx.summary.measure,
            bins: ctx.patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
          },
          n,
        ),
        grain: "pattern-by-length",
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
    name: "normalize",
    phase: "display",
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
    guard: (s) =>
      (s.tip === "summary" || s.tip === "displayed" || s.tip === "faceted") &&
      s.grain !== "run" &&
      !s.normalized &&
      s.source !== "run-scalars",
    guardMessage: "Normalize after aggregation; once only.",
    effect: (s) =>
      append(
        {
          ...s,
          tip: s.faceted ? "faceted" : "displayed",
          normalized: true,
        },
        "normalize",
      ),
  },
  {
    name: "facet_runs",
    phase: "display",
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
    guard: (s) =>
      (s.tip === "summary" || s.tip === "displayed") && !s.faceted && s.source !== "run-scalars",
    guardMessage: "Facet once from summary/displayed.",
    effect: (s) => append({ ...s, tip: "faceted", faceted: true }, "facet_runs"),
  },
  {
    name: "commit",
    phase: "construction",
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
    guard: (s) =>
      s.tip === "displayed" ||
      s.tip === "faceted" ||
      (s.tip === "summary" && (s.grain === "run" || s.grain === "length")),
    guardMessage: "Commit from renderable tip.",
    effect: (s) => append({ ...s, tip: "committed" }, "commit"),
  },
  {
    name: "select_bin",
    phase: "session",
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
    guard: (s) =>
      s.tip === "committed" || s.tip === "displayed" || s.tip === "faceted" || s.tip === "selected",
    guardMessage: "Select from a rendered view.",
    effect: (s, context) => {
      const sel = context as SelectionContext | undefined;
      if (!sel?.runId || !sel.binKey) throw new Error("Selection context required.");
      return applySelectBin(s, sel);
    },
  },
  {
    name: "clear_selection",
    phase: "session",
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
    guard: (s) => s.hasSelection || s.tip === "selected",
    guardMessage: "No selection.",
    effect: (s) => clearSessionTip(s),
  },
  {
    name: "open_pattern_detail",
    phase: "session",
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
    guard: (s) => (s.tip === "selected" || s.hasSelection) && s.selectionPatternId > 0,
    guardMessage: "Need a pattern selection.",
    effect: (s) => ({ ...s, detailRequested: true }),
  },
  {
    name: "close_pattern_detail",
    phase: "session",
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
    guard: (s) => s.detailRequested,
    guardMessage: "No pattern detail open.",
    effect: (s) => ({ ...s, detailRequested: false }),
  },
  {
    name: "focus_run",
    phase: "construction",
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
    guard: (s) => s.faceted && s.hasSelection && s.selectionRunId.length > 0,
    guardMessage: "Focus needs faceted view + run selection.",
    effect: (s) =>
      append(
        {
          ...s,
          faceted: false,
          tip: "committed",
        },
        "focus_run",
        { runId: s.selectionRunId },
      ),
  },
  {
    name: "drill_length_patterns",
    phase: "construction",
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
    guard: (s) =>
      s.grain === "length" &&
      (s.tip === "selected" || s.hasSelection) &&
      s.selectionLengthKey.length > 0 &&
      s.selectionLengthKey !== "other" &&
      isPatternSource(s),
    guardMessage: "Drill needs a length-bin selection on a pattern source.",
    effect: (s, context) => {
      const lengthKey = lengthKeyFromContext(context, s.selectionLengthKey);
      if (!lengthKey || lengthKey === "other") throw new Error("Drill needs a length key.");
      const limit =
        Number(
          context && typeof context === "object" && "limit" in context
            ? (context as { limit?: unknown }).limit
            : s.limit,
        ) || s.limit;
      return append(
        {
          ...clearSessionTip(s),
          tip: "committed",
          grain: "pattern-by-length",
          hasTopK: true,
          rankedByLength: false,
          limit,
        },
        "drill_length_patterns",
        { limit, lengthKey },
      );
    },
    interpret: (ctx, step) => {
      const n = Number(step.params?.limit ?? ctx.limit) || 10;
      const lengthKey = String(step.params?.lengthKey ?? "");
      if (!lengthKey) throw new Error("drill_length_patterns requires lengthKey.");
      const binValue = (bin: (typeof ctx.patternBins)[number]) =>
        ctx.measure === "vocabulary" ? 1 : bin.value;
      const cohort = ctx.patternBins
        .map((bin) => ({ ...bin, value: binValue(bin) }))
        .filter((bin) => patternLengthKey(bin) === lengthKey);
      const displayTotal = cohort.reduce((sum, bin) => sum + bin.value, 0);
      const summary: Summary = {
        scope: "run",
        grain: "pattern-by-length",
        measure: ctx.summary.measure,
        bins: topWithRemainder(cohort, displayTotal, n).map((bin) => {
          if (bin.key === "other") {
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
        grain: "pattern-by-length",
        hasTopK: true,
        rankedByLength: false,
        sql: `${ctx.sql}\n-- drill_length_patterns length=${lengthKey} limit=${n}`,
      };
    },
  },
  {
    name: "re_rollup",
    phase: "construction",
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
    guard: (s) =>
      (s.tip === "committed" || s.tip === "selected" || s.tip === "displayed") &&
      s.grain === "pattern" &&
      s.hasTopK &&
      isPatternSource(s),
    guardMessage: "Re-rollup from pattern top-k.",
    effect: (s) =>
      append(
        {
          ...clearSessionTip(s),
          tip: "committed",
          grain: "length",
          hasTopK: false,
          rankedByLength: false,
          normalized: false,
        },
        "re_rollup",
      ),
    interpret: (ctx) => {
      const binValue = (bin: (typeof ctx.patternBins)[number]) =>
        ctx.measure === "vocabulary" ? 1 : bin.value;
      return {
        ...ctx,
        summary: rollup(
          {
            scope: "run",
            grain: "pattern",
            measure: ctx.summary.measure,
            bins: ctx.patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
          },
          "length",
          patternLengthKey,
        ),
        grain: "length",
        hasTopK: false,
        rankedByLength: false,
        sql: `${ctx.sql}\n-- re_rollup`,
      };
    },
  },
];

export const morphismByName = new Map(morphismDefs.map((d) => [d.name, d]));

export const morphismCriteria: Record<string, MorphismDef["criteria"]> = Object.fromEntries(
  morphismDefs.map((d) => [d.name, d.criteria]),
);

export const morphismContracts: Record<string, MorphismDef["contract"]> = Object.fromEntries(
  morphismDefs.map((d) => [d.name, d.contract]),
);

export function morphismLabel(name: string): string {
  return morphismCriteria[name]?.label ?? name;
}

export function morphismWhat(name: string): string | undefined {
  return morphismCriteria[name]?.what;
}

export function morphismReloads(name: string): boolean {
  return morphismContracts[name]?.reload === true;
}

export function isUserFollowupChip(name: string): boolean {
  return morphismContracts[name]?.userFollowup !== false;
}
