import type { Bin } from "@workstream/viz-algebra";
import { topWithRemainder } from "@workstream/viz-algebra";
import { morphismByName } from "./morphisms/registry";
import type { InterpretCtx } from "./morphisms/types";
import type { PathState } from "./path-state";
import type { PathPlan, PathStep } from "./types";

/** Fallback for ad-hoc top_k_N steps (tests) not registered as discrete morphisms. */
function applyTopK(ctx: InterpretCtx, step: PathStep): InterpretCtx {
  const registered = morphismByName.get(step.name);
  if (registered?.interpret) return registered.interpret(ctx, step);
  const limit = Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
  const total =
    ctx.measure === "vocabulary"
      ? ctx.totals.nodes
      : ctx.measure === "edge-weight"
        ? ctx.totals.edgeWeight
        : ctx.totals.mass;
  if (ctx.summary.grain === "pattern-by-length") {
    return { ...ctx, limit, hasTopK: true, sql: `${ctx.sql}\n-- top_k_${limit}` };
  }
  const bins =
    ctx.rankedByLength && ctx.summary.grain === "pattern"
      ? (() => {
          const top = ctx.summary.bins.slice(0, limit);
          const remainder = total - top.reduce((sum, bin) => sum + bin.value, 0);
          return remainder > 0
            ? [...top, { key: "other", label: "All other patterns", value: remainder }]
            : top;
        })()
      : topWithRemainder(ctx.summary.bins, total, limit);
  return {
    ...ctx,
    summary: { ...ctx.summary, bins },
    limit,
    hasTopK: true,
    sql: `${ctx.sql}\n-- top_k_${limit}`,
  };
}

export type InterpretedFacet = {
  bins: Bin[];
  total: number;
  unit: string;
  sql: string;
  overview?: boolean;
};

function unitFor(measure: PathState["measure"]): string {
  if (measure === "vocabulary") return "patterns";
  if (measure === "edge-weight") return "outgoing edge weight";
  return "stored counts";
}

/** Apply path steps to an in-memory pattern/edge summary (one run). */
export function interpretSummary(
  steps: PathStep[],
  patternBins: Bin[],
  totals: { mass: number; nodes: number; edgeWeight: number },
): InterpretedFacet {
  let ctx: InterpretCtx = {
    source: "none",
    measure: "none",
    grain: "none",
    limit: 10,
    hasTopK: false,
    rankedByLength: false,
    sql: "",
    summary: {
      scope: "run",
      grain: "pattern",
      measure: "stored-count",
      bins: [],
    },
    displayTotal: 0,
    patternBins,
    totals,
  };

  // First pass: load morphisms set source/measure before building bins.
  for (const step of steps) {
    const def = morphismByName.get(step.name);
    if (def?.name.startsWith("load_") && def.interpret) {
      ctx = def.interpret(ctx, step);
    }
  }

  if (ctx.source === "run-scalars") {
    return { bins: [], total: 0, unit: "", sql: ctx.sql, overview: true };
  }

  const binValue = (bin: Bin) => (ctx.measure === "vocabulary" ? 1 : bin.value);
  const measure = ctx.measure === "none" ? "stored-count" : ctx.measure;
  const total =
    ctx.measure === "vocabulary"
      ? totals.nodes
      : ctx.measure === "edge-weight"
        ? totals.edgeWeight
        : totals.mass;

  ctx.summary = {
    scope: "run",
    grain: "pattern",
    measure,
    bins: patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
  };
  ctx.displayTotal = total;

  for (const step of steps) {
    if (step.name.startsWith("load_")) continue;
    if (step.name.startsWith("top_k_")) {
      ctx = applyTopK(ctx, step);
      continue;
    }
    const def = morphismByName.get(step.name);
    if (def?.interpret) ctx = def.interpret(ctx, step);
  }

  return {
    bins: ctx.summary.bins,
    total: ctx.displayTotal,
    unit: unitFor(ctx.measure),
    sql: ctx.sql || "-- empty",
  };
}

export function pathTitle(state: PathState): { title: string; description: string } {
  const parts = state.steps.map((s) => s.name).filter((n) => n !== "commit");
  const title = parts.length ? parts.join(" → ") : "Empty path";
  const description = `${state.source} · ${state.grain} · ${state.measure}${state.faceted ? " · faceted" : ""}${state.normalized ? " · normalized" : ""}`;
  return { title, description };
}

export function planNormalized(plan: PathPlan): boolean {
  return plan.steps.some((s) => s.name === "normalize");
}

export function planLimit(plan: PathPlan): number {
  for (let i = plan.steps.length - 1; i >= 0; i--) {
    const step = plan.steps[i];
    if (!step) continue;
    if (step.name.startsWith("top_k_")) {
      return Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
    }
    if (step.name === "partition_by_length" || step.name === "drill_length_patterns") {
      return Number(step.params?.limit) || 10;
    }
  }
  return 10;
}

export function planIsOverview(plan: PathPlan): boolean {
  return plan.steps.some((s) => s.name === "load_run_scalars");
}
