/** Objects carry semantic scope; operators may compose only across matching contracts. */

import { patternDisplayLabel } from "./decode";

export type Grain = "run" | "pattern" | "length";
export type Measure = "stored-count" | "vocabulary" | "edge-weight";
export type TipKind = "query" | "summary" | "displayed" | "faceted" | "selected" | "committed";

export type Bin = { key: string; label: string; value: number; id?: number; token?: string };
export type Summary = {
  scope: string;
  grain: string;
  measure: string;
  bins: Bin[];
};
export type Arrow<A, B> = (input: A) => B;

export type PathStep = { name: string; params?: Record<string, unknown> };
/** Serializable morphism path — the render plan. */
export type PathPlan = {
  steps: PathStep[];
  runs: string[];
};

export function compose<A, B, C>(f: Arrow<A, B>, g: Arrow<B, C>): Arrow<A, C> {
  return (input) => g(f(input));
}

/** Commutative addition applies to disjoint partitions of the SAME population. */
export function merge(a: Summary, b: Summary): Summary {
  if (a.scope !== b.scope || a.grain !== b.grain || a.measure !== b.measure) {
    throw new Error("Cannot merge different populations, grains, or measures; facet instead.");
  }
  const bins = new Map<string, Bin>();
  for (const bin of [...a.bins, ...b.bins]) {
    const prior = bins.get(bin.key);
    bins.set(bin.key, { ...bin, value: bin.value + (prior?.value ?? 0) });
  }
  return { ...a, bins: [...bins.values()].sort((x, y) => x.key.localeCompare(y.key)) };
}

export function rollup(summary: Summary, grain: string, key: (bin: Bin) => string): Summary {
  return summary.bins.reduce<Summary>(
    (acc, bin) =>
      merge(acc, {
        ...summary,
        grain,
        bins: [{ key: key(bin), label: key(bin), value: bin.value }],
      }),
    { ...summary, grain, bins: [] },
  );
}

/** Irreversible display boundary. Never use a top-k result as a mergeable summary. */
export function topWithRemainder(bins: Bin[], total: number, limit: number): Bin[] {
  const top = [...bins]
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, limit);
  const remainder = total - top.reduce((sum, bin) => sum + bin.value, 0);
  if (remainder < -1e-7) throw new Error("Displayed bins exceed the source total.");
  return remainder > 0
    ? [...top, { key: "other", label: "All other patterns", value: remainder }]
    : top;
}

export function normalize(bins: Bin[], denominator: number): (Bin & { fraction: number })[] {
  return bins.map((bin) => ({ ...bin, fraction: denominator > 0 ? bin.value / denominator : 0 }));
}

/** Pipe-count length, capped at 32 — matches lattice lengthSql. */
export function patternLengthKey(bin: Bin): string {
  const token = bin.token ?? bin.key;
  let pipes = 0;
  for (let i = 0; i < token.length; i++) if (token[i] === "|") pipes++;
  return String(Math.min(32, pipes));
}

/**
 * Group patterns by length, then top-k within each length partition.
 * Not equivalent to global top-k then grouping.
 */
export function patternsByLength(summary: Summary, limit: number): Summary {
  const groups = new Map<string, Bin[]>();
  for (const bin of summary.bins) {
    const length = patternLengthKey(bin);
    const list = groups.get(length);
    if (list) list.push(bin);
    else groups.set(length, [bin]);
  }
  const bins: Bin[] = [];
  for (const length of [...groups.keys()].sort((a, b) => Number(a) - Number(b))) {
    const group = groups.get(length) ?? [];
    const total = group.reduce((sum, bin) => sum + bin.value, 0);
    for (const bin of topWithRemainder(group, total, limit)) {
      const lengthTag = length === "32" ? "32+" : length;
      const name = bin.key === "other" ? "other" : patternDisplayLabel(bin);
      bins.push({
        ...bin,
        key: `${length}:${bin.key === "other" ? "other" : String(bin.id ?? bin.key)}`,
        label: `${lengthTag} · ${name}`,
      });
    }
  }
  return { ...summary, grain: "pattern-by-length", bins };
}

export const MAX_PATH_STEPS = 8;

/** Named preset paths (macros for docs/rules — not a separate plan type). */
export const presetPaths: Record<string, PathStep[]> = {
  overview: [{ name: "load_run_scalars" }, { name: "commit" }],
  patterns: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
  lengths: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
  connectivity: [{ name: "load_edge_weight" }, { name: "top_k_10" }, { name: "commit" }],
  "patterns-by-length": [
    { name: "load_pattern_mass" },
    { name: "partition_by_length" },
    { name: "commit" },
  ],
};
