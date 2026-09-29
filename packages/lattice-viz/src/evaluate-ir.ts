import { type Bin, rollup, type Summary, topWithRemainder } from "@workstream/viz-algebra";
import type { ExecutionIR, MeasureKind } from "./execution-ir";
import type { InterpretedFacet } from "./interpret";
import { patternDisplayLabel } from "./labels";
import { patternLengthKey, patternsByLength } from "./pattern-length";

type Totals = { mass: number; nodes: number; edgeWeight: number; hubScore: number };

function totalForMeasure(measure: MeasureKind, totals: Totals): number {
  if (measure === "vocabulary") return totals.nodes;
  if (measure === "edge-weight" || measure === "in-edge-weight") return totals.edgeWeight;
  if (measure === "hub-score") return totals.hubScore;
  return totals.mass;
}

function unitFor(measure: MeasureKind): string {
  if (measure === "vocabulary") return "patterns";
  if (measure === "edge-weight") return "outgoing edge weight";
  if (measure === "in-edge-weight") return "incoming edge weight";
  if (measure === "hub-score") return "hub score";
  return "stored counts";
}

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

/**
 * Reference in-memory IR evaluator — denotation oracle for SQLite lowering.
 * Facet/focusRun/commit are planning ops (no bin change).
 */
export function evaluateIR(ir: ExecutionIR, patternBins: Bin[], totals: Totals): InterpretedFacet {
  let measure: MeasureKind = "stored-count";
  let summary: Summary = {
    scope: "run",
    grain: "pattern",
    measure: "stored-count",
    bins: [],
  };
  let displayTotal = 0;
  let overview = false;
  let normalized = false;
  const sqlParts: string[] = [];

  for (const op of ir.ops) {
    switch (op.op) {
      case "load": {
        measure = op.measure;
        if (measure === "run-scalars") {
          overview = true;
          sqlParts.push("-- load_run_scalars");
          break;
        }
        const binValue = (bin: Bin) => (measure === "vocabulary" ? 1 : bin.value);
        summary = {
          scope: "run",
          grain: "pattern",
          measure:
            measure === "stored-count"
              ? "stored-count"
              : measure === "vocabulary"
                ? "vocabulary"
                : measure === "hub-score"
                  ? "hub-score"
                  : measure === "in-edge-weight"
                    ? "in-edge-weight"
                    : "edge-weight",
          bins: patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
        };
        displayTotal = totalForMeasure(measure, totals);
        sqlParts.push(`-- load ${op.source}`);
        break;
      }
      case "rollupLength": {
        summary = rollup(summary, "length", patternLengthKey);
        sqlParts.push("-- rollup_length");
        break;
      }
      case "rankByLength": {
        summary = { ...summary, bins: rankBinsByLength(summary.bins) };
        sqlParts.push("-- rank_by_length");
        break;
      }
      case "topK": {
        const total = displayTotal || totalForMeasure(measure, totals);
        const bins =
          op.by === "order"
            ? topInOrder(summary.bins, total, op.limit)
            : summary.grain === "pattern-by-length"
              ? summary.bins
              : topWithRemainder(summary.bins, total, op.limit);
        summary = { ...summary, bins };
        sqlParts.push(`-- top_k_${op.limit}`);
        break;
      }
      case "partitionByLength": {
        const binValue = (bin: Bin) => (measure === "vocabulary" ? 1 : bin.value);
        summary = patternsByLength(
          {
            scope: "run",
            grain: "pattern",
            measure: summary.measure,
            bins: patternBins.map((bin) => ({ ...bin, value: binValue(bin) })),
          },
          op.limit,
        );
        displayTotal = totalForMeasure(measure, totals);
        sqlParts.push(`-- partition_by_length limit=${op.limit}`);
        break;
      }
      case "filterLength": {
        const binValue = (bin: Bin) => (measure === "vocabulary" ? 1 : bin.value);
        const cohort = patternBins
          .map((bin) => ({ ...bin, value: binValue(bin) }))
          .filter((bin) => patternLengthKey(bin) === op.lengthKey);
        displayTotal = cohort.reduce((sum, bin) => sum + bin.value, 0);
        summary = {
          scope: "run",
          grain: "pattern-by-length",
          measure: summary.measure,
          bins: topWithRemainder(cohort, displayTotal, op.limit).map((bin) => {
            if (bin.key === "other") {
              return {
                ...bin,
                key: `${op.lengthKey}:other`,
                label: `All other length-${op.lengthKey} patterns`,
              };
            }
            const lengthTag = op.lengthKey === "32" ? "32+" : op.lengthKey;
            return {
              ...bin,
              key: `${op.lengthKey}:${String(bin.id ?? bin.key)}`,
              label: `${lengthTag} · ${patternDisplayLabel(bin)}`,
            };
          }),
        };
        sqlParts.push(`-- drill_length_patterns length=${op.lengthKey} limit=${op.limit}`);
        break;
      }
      case "reRollup": {
        const binValue = (bin: Bin) => (measure === "vocabulary" ? 1 : bin.value);
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
        displayTotal = totalForMeasure(measure, totals);
        sqlParts.push("-- re_rollup");
        break;
      }
      case "normalize":
        normalized = true;
        sqlParts.push("-- normalize");
        break;
      case "facet":
      case "commit":
      case "focusRun":
        sqlParts.push(`-- ${op.op}`);
        break;
      default:
        break;
    }
  }

  if (overview) {
    return { bins: [], total: 0, unit: "", sql: sqlParts.join("\n") || "-- empty", overview: true };
  }

  return {
    bins: summary.bins,
    total: displayTotal,
    unit: unitFor(measure),
    sql: sqlParts.join("\n") || "-- empty",
    normalized,
  };
}
