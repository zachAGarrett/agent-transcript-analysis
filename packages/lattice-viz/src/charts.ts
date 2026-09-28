import { normalize } from "@workstream/viz-algebra";
import { patternDisplayLabel } from "./labels";
import type { PathState, SelectionContext } from "./path-state";
import type { Facet, View } from "./types";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

export const stamp = (id: string) =>
  `${id.slice(5, 10)} · ${id.slice(11, 16).replace("-", ":")} UTC`;

export function isResidual(key: string) {
  return key === "other" || key.endsWith(":other");
}

export function lengthKeyForBin(binKey: string, pathState: PathState | null): string | undefined {
  if (pathState?.grain === "length" && !isResidual(binKey)) return binKey;
  if (binKey.includes(":")) {
    const prefix = binKey.split(":")[0] ?? "";
    if (prefix && prefix !== "other") return prefix;
  }
  return undefined;
}

export type FacetChartRow = {
  key: string;
  /** Short category-axis tick (pattern #id, length, or residual copy). */
  label: string;
  /** Tooltip title: intent/purpose chain when available. */
  hoverLabel: string;
  value: number;
  raw: number;
  residual: boolean;
  selected: boolean;
  id?: number;
  token?: string;
  lengthKey?: string;
  runId: string;
};

export type FacetChartModel = {
  runId: string;
  title: string;
  subtitle: string;
  footer: string;
  unit: string;
  categoryAxisLabel: string;
  valueAxisLabel: string;
  rows: FacetChartRow[];
  domainMax: number;
  normalized: boolean;
};

function categoryAxisLabelFor(grain: PathState["grain"] | undefined): string {
  switch (grain) {
    case "length":
      return "Composite length";
    case "pattern-by-length":
      return "Pattern by length";
    case "pattern":
      return "Pattern";
    case "run":
      return "Run";
    default:
      return "Category";
  }
}

function valueAxisLabelFor(unit: string, normalized: boolean): string {
  return normalized ? "Share of run total" : unit;
}

function categoryTickLabel(
  bin: { label: string; id?: number; key: string },
  residual: boolean,
  grain: PathState["grain"] | undefined,
): string {
  if (residual) return bin.label;
  if (grain === "length") return `Length ${bin.label}`;
  if (bin.id != null) return `#${bin.id}`;
  return bin.label;
}

function categoryHoverLabel(
  bin: { label: string; id?: number; key: string; token?: string },
  residual: boolean,
  grain: PathState["grain"] | undefined,
): string {
  if (residual || grain === "length" || grain === "run") return bin.label;
  return patternDisplayLabel(bin);
}

export type OverviewMetricModel = {
  key: "nodes" | "mass" | "edges";
  label: string;
  note: string;
  rows: { runId: string; label: string; value: number; selected: boolean }[];
  domainMax: number;
};

/** Shared absolute/normalized scale across facets for comparable bars. */
export function sharedDomainMax(view: View, normalized: boolean): number {
  return Math.max(
    0.0001,
    ...view.facets.flatMap((facet) =>
      facet.bins.map((bin) =>
        normalized ? (facet.total ? bin.value / facet.total : 0) : bin.value,
      ),
    ),
  );
}

export function facetChartModel(
  facet: Facet,
  domainMax: number,
  normalized: boolean,
  selection: SelectionContext | null,
  pathState: PathState | null,
): FacetChartModel {
  const grain = pathState?.grain;
  const rows = normalize(facet.bins, facet.total).map((bin) => {
    const residual = isResidual(bin.key);
    return {
      key: bin.key,
      label: categoryTickLabel(bin, residual, grain),
      hoverLabel: categoryHoverLabel(bin, residual, grain),
      value: normalized ? bin.fraction : bin.value,
      raw: bin.value,
      residual,
      selected: selection?.binKey === bin.key && selection.runId === facet.run.id,
      id: bin.id,
      token: bin.token,
      lengthKey: lengthKeyForBin(bin.key, pathState),
      runId: facet.run.id,
    } satisfies FacetChartRow;
  });
  return {
    runId: facet.run.id,
    title: stamp(facet.run.id),
    subtitle: `${facet.unit} · shared ${normalized ? "relative" : "absolute"} scale`,
    footer: `${number(facet.total)} ${facet.unit} · ${facet.bins.length} bins`,
    unit: facet.unit,
    categoryAxisLabel: categoryAxisLabelFor(grain),
    valueAxisLabel: valueAxisLabelFor(facet.unit, normalized),
    rows,
    domainMax,
    normalized,
  };
}

export function facetChartModels(
  view: View,
  normalized: boolean,
  selection: SelectionContext | null,
  pathState: PathState | null,
): FacetChartModel[] {
  const domainMax = sharedDomainMax(view, normalized);
  return view.facets.map((facet) =>
    facetChartModel(facet, domainMax, normalized, selection, pathState),
  );
}

export function overviewMetricModels(view: View, selected: string): OverviewMetricModel[] {
  const metrics = [
    ["nodes", "Vocabulary size", "Distinct patterns"],
    ["mass", "Stored count mass", "Sum of token_count"],
    ["edges", "Edges", "Distinct directed edges"],
  ] as const;
  return metrics.map(([key, label, note]) => {
    const domainMax = Math.max(1, ...view.facets.map((facet) => facet.run[key]));
    return {
      key,
      label,
      note,
      domainMax,
      rows: view.facets.map(({ run }) => ({
        runId: run.id,
        label: stamp(run.id),
        value: run[key],
        selected: run.id === selected,
      })),
    };
  });
}

export function formatChartValue(value: number, normalized: boolean): string {
  return normalized ? `${number(value * 100)}%` : number(value);
}
