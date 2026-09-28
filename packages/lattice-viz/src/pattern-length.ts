import type { Bin, Summary } from "@workstream/viz-algebra";
import { topWithRemainder } from "@workstream/viz-algebra";
import { patternDisplayLabel } from "./labels";

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
