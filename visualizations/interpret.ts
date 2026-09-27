import {
  type Bin,
  type PathPlan,
  type PathStep,
  patternLengthKey,
  patternsByLength,
  rollup,
  type Summary,
  topWithRemainder,
} from "./algebra";
import { patternDisplayLabel } from "./decode";
import type { PathState } from "./path-space";

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

/** Keep current bin order; residual conserves total (no value re-sort). */
function topInOrder(bins: Bin[], total: number, limit: number): Bin[] {
  const top = bins.slice(0, limit);
  const remainder = total - top.reduce((sum, bin) => sum + bin.value, 0);
  if (remainder < -1e-7) throw new Error("Displayed bins exceed the source total.");
  return remainder > 0
    ? [...top, { key: "other", label: "All other patterns", value: remainder }]
    : top;
}

function rankBinsByLength(bins: Bin[]): Bin[] {
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

/** Apply path steps to an in-memory pattern/edge summary (one run). */
export function interpretSummary(
  steps: PathStep[],
  patternBins: Bin[],
  totals: { mass: number; nodes: number; edgeWeight: number },
): InterpretedFacet {
  let source: PathState["source"] = "none";
  let measure: PathState["measure"] = "none";
  let grain: PathState["grain"] = "none";
  let limit = 10;
  let hasTopK = false;
  let rankedByLength = false;
  let sql = "";

  for (const step of steps) {
    if (step.name === "load_pattern_mass") {
      source = "pattern-mass";
      measure = "stored-count";
      grain = "pattern";
      sql = "SELECT id, token, token_count value FROM nodes";
    } else if (step.name === "load_pattern_vocab") {
      source = "pattern-vocab";
      measure = "vocabulary";
      grain = "pattern";
      sql = "SELECT id, token, 1 value FROM nodes";
    } else if (step.name === "load_edge_weight") {
      source = "edge-weight";
      measure = "edge-weight";
      grain = "pattern";
      sql =
        "SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n LEFT JOIN (SELECT from_id, sum(weight) value FROM edges GROUP BY from_id) e ON e.from_id = n.id";
    } else if (step.name === "load_run_scalars") {
      source = "run-scalars";
      measure = "stored-count";
      grain = "run";
      sql = "run scalars";
    } else if (step.name.startsWith("top_k_")) {
      limit = Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
      hasTopK = true;
    }
  }

  if (source === "run-scalars") {
    return { bins: [], total: 0, unit: "", sql, overview: true };
  }

  const binValue = (bin: Bin) => {
    if (measure === "vocabulary") return 1;
    return bin.value;
  };

  let summary: Summary = {
    scope: "run",
    grain: "pattern",
    measure: measure === "none" ? "stored-count" : measure,
    bins: patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
  };

  const total =
    measure === "vocabulary"
      ? totals.nodes
      : measure === "edge-weight"
        ? totals.edgeWeight
        : totals.mass;

  for (const step of steps) {
    if (step.name === "rollup_length") {
      summary = rollup(summary, "length", patternLengthKey);
      grain = "length";
      rankedByLength = false;
      sql += "\n-- rollup_length";
    } else if (step.name === "rank_by_length") {
      summary = { ...summary, bins: rankBinsByLength(summary.bins) };
      grain = "pattern";
      rankedByLength = true;
      sql += "\n-- rank_by_length";
    } else if (step.name === "partition_by_length" || step.name === "drill_length_patterns") {
      const n = Number(step.params?.limit ?? limit) || 10;
      limit = n;
      summary = patternsByLength(
        {
          scope: "run",
          grain: "pattern",
          measure: summary.measure,
          bins: patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
        },
        n,
      );
      grain = "pattern-by-length";
      hasTopK = true;
      rankedByLength = false;
      sql += `\n-- ${step.name} limit=${n}`;
    } else if (step.name === "re_rollup") {
      summary = rollup(
        {
          scope: "run",
          grain: "pattern",
          measure: summary.measure,
          bins: patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
        },
        "length",
        patternLengthKey,
      );
      grain = "length";
      hasTopK = false;
      rankedByLength = false;
      sql += "\n-- re_rollup";
    } else if (step.name.startsWith("top_k_")) {
      const n = Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
      if (rankedByLength && summary.grain === "pattern") {
        summary = {
          ...summary,
          bins: topInOrder(summary.bins, total, n),
        };
      } else if (summary.grain === "pattern-by-length") {
        /* already residualized per length */
      } else {
        summary = {
          ...summary,
          bins: topWithRemainder(summary.bins, total, n),
        };
      }
      hasTopK = true;
      sql += `\n-- top_k_${n}`;
    } else if (step.name === "normalize" || step.name === "facet_runs" || step.name === "commit") {
      /* flags handled by path state / plan.runs */
    }
  }

  // patterns-by-length construction uses partition (already residualized per length).
  void hasTopK;
  void grain;

  return {
    bins: summary.bins,
    total,
    unit: unitFor(measure),
    sql: sql || "-- empty",
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
