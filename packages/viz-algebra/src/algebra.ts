/** Objects carry semantic scope; operators may compose only across matching contracts. */

export type Bin = { key: string; label: string; value: number; id?: number; token?: string };
export type Summary = {
  scope: string;
  grain: string;
  measure: string;
  bins: Bin[];
};
export type Arrow<A, B> = (input: A) => B;

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
