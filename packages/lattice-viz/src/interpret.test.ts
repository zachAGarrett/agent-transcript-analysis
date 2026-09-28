import { describe, expect, test } from "bun:test";
import type { Bin } from "@workstream/viz-algebra";
import { interpretSummary } from "./interpret";

describe("interpret rank_by_length", () => {
  test("longer low-mass pattern ranks above short high-mass; top-k conserves total", () => {
    const bins: Bin[] = [
      { key: "1", label: "#1", value: 100, id: 1, token: "a" },
      { key: "2", label: "#2", value: 5, id: 2, token: "b|c|d" },
      { key: "3", label: "#3", value: 20, id: 3, token: "e|f" },
    ];
    const total = 125;
    const ranked = interpretSummary(
      [{ name: "load_pattern_mass" }, { name: "rank_by_length" }],
      bins,
      { mass: total, nodes: 3, edgeWeight: 0, hubScore: 0 },
    );
    expect(ranked.bins.map((b) => b.id)).toEqual([2, 3, 1]);
    expect(ranked.bins[0]?.label).toBe("2 · Pattern #2");

    const topped = interpretSummary(
      [
        { name: "load_pattern_mass" },
        { name: "rank_by_length" },
        { name: "top_k_1", params: { limit: 1 } },
      ],
      bins,
      { mass: total, nodes: 3, edgeWeight: 0, hubScore: 0 },
    );
    expect(topped.bins[0]?.id).toBe(2);
    expect(topped.bins.map((b) => b.value)).toEqual([5, 120]);
    expect(topped.bins.reduce((sum, b) => sum + b.value, 0)).toBe(total);
  });

  test("top-k without rank sorts by value", () => {
    const bins: Bin[] = [
      { key: "1", label: "#1", value: 100, id: 1, token: "a" },
      { key: "2", label: "#2", value: 5, id: 2, token: "b|c|d" },
    ];
    const topped = interpretSummary(
      [{ name: "load_pattern_mass" }, { name: "top_k_1", params: { limit: 1 } }],
      bins,
      { mass: 105, nodes: 2, edgeWeight: 0, hubScore: 0 },
    );
    expect(topped.bins[0]?.id).toBe(1);
  });
});

describe("interpret drill_length_patterns", () => {
  test("scopes top-k to the selected length only", () => {
    const bins: Bin[] = [
      { key: "1", label: "#1", value: 100, id: 1, token: "a" },
      { key: "2", label: "#2", value: 5, id: 2, token: "b|c|d" },
      { key: "3", label: "#3", value: 20, id: 3, token: "e|f" },
      { key: "4", label: "#4", value: 8, id: 4, token: "g|h" },
    ];
    const drilled = interpretSummary(
      [
        { name: "load_pattern_mass" },
        { name: "rollup_length" },
        { name: "drill_length_patterns", params: { limit: 1, lengthKey: "1" } },
      ],
      bins,
      { mass: 133, nodes: 4, edgeWeight: 0, hubScore: 0 },
    );
    // length 1 only: #3=20, #4=8 → top-1 keeps #3 + residual 8
    expect(drilled.total).toBe(28);
    expect(drilled.bins.every((b) => b.key.startsWith("1:"))).toBe(true);
    expect(drilled.bins.some((b) => b.id === 3)).toBe(true);
    expect(drilled.bins.some((b) => b.id === 1)).toBe(false);
    expect(drilled.bins.some((b) => b.id === 2)).toBe(false);
    expect(drilled.bins.reduce((sum, b) => sum + b.value, 0)).toBe(28);
    expect(drilled.sql).toContain("drill_length_patterns length=1 limit=1");
  });

  test("requires lengthKey on the drill step", () => {
    const bins: Bin[] = [
      { key: "1", label: "#1", value: 10, id: 1, token: "a" },
      { key: "2", label: "#2", value: 5, id: 2, token: "b|c" },
    ];
    expect(() =>
      interpretSummary(
        [{ name: "load_pattern_mass" }, { name: "drill_length_patterns", params: { limit: 5 } }],
        bins,
        { mass: 15, nodes: 2, edgeWeight: 0, hubScore: 0 },
      ),
    ).toThrow(/lengthKey/);
  });
});

describe("interpret partition_by_length", () => {
  test("keeps long low-mass patterns that global top-k would drop", () => {
    const bins: Bin[] = [
      { key: "1", label: "#1", value: 100, id: 1, token: "a" },
      { key: "2", label: "#2", value: 5, id: 2, token: "b|c|d" },
      { key: "3", label: "#3", value: 20, id: 3, token: "e|f" },
      { key: "4", label: "#4", value: 8, id: 4, token: "g|h" },
    ];
    const total = 133;
    const partitioned = interpretSummary(
      [{ name: "load_pattern_mass" }, { name: "partition_by_length", params: { limit: 1 } }],
      bins,
      { mass: total, nodes: 4, edgeWeight: 0, hubScore: 0 },
    );
    expect(partitioned.bins.some((b) => b.id === 2)).toBe(true);
    expect(partitioned.bins.some((b) => b.id === 1)).toBe(true);
    expect(partitioned.bins.reduce((sum, b) => sum + b.value, 0)).toBe(total);
    expect(partitioned.sql).toContain("partition_by_length limit=1");

    const globalTop = interpretSummary(
      [{ name: "load_pattern_mass" }, { name: "top_k_1", params: { limit: 1 } }],
      bins,
      { mass: total, nodes: 4, edgeWeight: 0, hubScore: 0 },
    );
    expect(globalTop.bins.map((b) => b.id ?? b.key)).toEqual([1, "other"]);
    expect(globalTop.bins.some((b) => b.id === 2)).toBe(false);
  });

  test("per-length residual when limit is 1", () => {
    const bins: Bin[] = [
      { key: "1", label: "#1", value: 10, id: 1, token: "a" },
      { key: "2", label: "#2", value: 3, id: 2, token: "b" },
      { key: "3", label: "#3", value: 5, id: 3, token: "c|d" },
      { key: "4", label: "#4", value: 2, id: 4, token: "e|f" },
    ];
    const out = interpretSummary(
      [{ name: "load_pattern_mass" }, { name: "partition_by_length", params: { limit: 1 } }],
      bins,
      { mass: 20, nodes: 4, edgeWeight: 0, hubScore: 0 },
    );
    // length 0: #1=10, residual 3; length 1: #3=5, residual 2
    expect(out.bins.filter((b) => b.key.endsWith(":other")).map((b) => b.value)).toEqual([3, 2]);
    expect(out.bins.find((b) => b.id === 1)?.label).toBe("0 · Pattern #1");
    expect(out.bins.find((b) => b.id === 3)?.label).toBe("1 · Pattern #3");
    expect(out.bins.reduce((sum, b) => sum + b.value, 0)).toBe(20);
  });
});
