import { describe, expect, test } from "bun:test";
import { Morphism } from "@workstream/lattice-viz";
import {
  buildChartPlan,
  buildLengthPatternsPlan,
  CATEGORY_VIEWS,
  CONN_MEASURES,
  EXPLORER_VIEWS,
  resolveChartPreset,
} from "./views";

describe("fixed category views", () => {
  test("explorer lists lattice, connectivity, replay", () => {
    expect(EXPLORER_VIEWS.map((v) => v.id)).toEqual(["lattice", "connectivity", "replay"]);
  });

  test("lattice top patterns chart uses a length picker (All + drills)", () => {
    const patterns = CATEGORY_VIEWS.lattice.charts.find((c) => c.id === "patterns");
    expect(patterns?.title).toBe("Top patterns");
    expect(patterns?.lengthPicker).toBe(true);
    expect(CATEGORY_VIEWS.lattice.charts.some((c) => c.id === "patterns-by-length")).toBe(false);
  });

  test("connectivity has two polymorphic charts", () => {
    const charts = CATEGORY_VIEWS.connectivity.charts;
    expect(charts.map((c) => c.id)).toEqual(["patterns", "lengths"]);
    expect(charts.every((c) => c.measurePicker)).toBe(true);
    expect(charts.find((c) => c.id === "patterns")?.lengthPicker).toBe(true);
    expect(charts.find((c) => c.id === "lengths")?.lengthHistogram).toBe(true);
    expect(CONN_MEASURES.map((m) => m.id)).toEqual(["outgoing", "incoming", "hub"]);
  });

  test("resolveChartPreset maps connectivity measure to presets", () => {
    const patterns = CATEGORY_VIEWS.connectivity.charts.find((c) => c.id === "patterns");
    const lengths = CATEGORY_VIEWS.connectivity.charts.find((c) => c.id === "lengths");
    expect(patterns).toBeDefined();
    expect(lengths).toBeDefined();
    if (!patterns || !lengths) return;
    expect(resolveChartPreset(patterns, "outgoing")).toBe("connectivity");
    expect(resolveChartPreset(patterns, "incoming")).toBe("inflows");
    expect(resolveChartPreset(patterns, "hub")).toBe("hubs");
    expect(resolveChartPreset(lengths, "outgoing")).toBe("lengths-by-edge");
    expect(resolveChartPreset(lengths, "incoming")).toBe("lengths-by-in");
    expect(resolveChartPreset(lengths, "hub")).toBe("lengths-by-hub");
  });

  test("buildChartPlan applies display knobs to patterns preset", () => {
    const plan = buildChartPlan(
      "patterns",
      { limit: 20, normalized: true, faceted: true },
      ["a", "b"],
      "a",
    );
    expect(plan.runs).toEqual(["a", "b"]);
    expect(plan.steps.map((s) => s.name)).toEqual([
      Morphism.loadPatternMass,
      Morphism.topK20,
      Morphism.normalize,
      Morphism.facetRuns,
      Morphism.commit,
    ]);
  });

  test("buildLengthPatternsPlan drills one length with display limit", () => {
    const plan = buildLengthPatternsPlan(
      "2",
      { limit: 5, normalized: false, faceted: false },
      ["a"],
      "a",
    );
    expect(plan.steps.map((s) => s.name)).toEqual([
      Morphism.loadPatternMass,
      Morphism.rollupLength,
      Morphism.commit,
      Morphism.drillLengthPatterns,
    ]);
    const drill = plan.steps.at(-1);
    expect(drill?.params?.lengthKey).toBe("2");
    expect(drill?.params?.limit).toBe(5);
  });

  test("buildLengthPatternsPlan accepts edge-weight load", () => {
    const plan = buildLengthPatternsPlan(
      "1",
      { limit: 10, normalized: false, faceted: false },
      ["a"],
      "a",
      Morphism.loadEdgeWeight,
    );
    expect(plan.steps[0]?.name).toBe(Morphism.loadEdgeWeight);
    expect(plan.steps.at(-1)?.params?.lengthKey).toBe("1");
  });

  test("buildChartPlan patches partition_by_length limit", () => {
    const plan = buildChartPlan(
      "patterns-by-length",
      { limit: 5, normalized: false, faceted: false },
      ["a"],
      "a",
    );
    const partition = plan.steps.find((s) => s.name === Morphism.partitionByLength);
    expect(partition?.params?.limit).toBe(5);
  });

  test("lengths-by-in preset exists", () => {
    const plan = buildChartPlan(
      "lengths-by-in",
      { limit: 10, normalized: false, faceted: false },
      ["a"],
      "a",
    );
    expect(plan.steps.map((s) => s.name)).toEqual([
      Morphism.loadInDegree,
      Morphism.rollupLength,
      Morphism.commit,
    ]);
  });
});
