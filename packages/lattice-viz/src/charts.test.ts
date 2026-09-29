import { describe, expect, test } from "bun:test";
import { facetChartModel, formatChartValue, isResidual, sharedDomainMax } from "./charts";
import { Grain, Source, Tip } from "./ids";
import { initialPathState } from "./path-state";
import type { Facet, View } from "./types";

const facet = (bins: { key: string; label: string; value: number; id?: number }[]): Facet => ({
  run: {
    id: "2026-01-01T00-00-00Z",
    version: "v",
    nodes: 2,
    mass: 30,
    edges: 0,
    edgeWeight: 0,
    maxWeight: 0,
    hubScore: 0,
    scored: 0,
    fixture: null,
    train: null,
    heldOut: null,
    warning: null,
  },
  bins,
  total: 30,
  unit: "stored counts",
  sql: "-- test",
});

describe("chart boundary", () => {
  test("sharedDomainMax respects normalized shares", () => {
    const view: View = {
      plan: { steps: [], runs: ["a"] },
      facets: [
        facet([
          { key: "1", label: "a", value: 20 },
          { key: "2", label: "b", value: 10 },
        ]),
      ],
      generatedAt: "",
      cacheHit: false,
    };
    expect(sharedDomainMax(view, false)).toBe(20);
    expect(sharedDomainMax(view, true)).toBeCloseTo(20 / 30);
  });

  test("facetChartModel uses fractions when normalized", () => {
    const model = facetChartModel(
      facet([{ key: "1", label: "a", value: 20, id: 1 }]),
      1,
      true,
      null,
      { ...initialPathState, tip: Tip.committed, grain: Grain.pattern, source: Source.patternMass },
    );
    expect(model.normalized).toBe(true);
    expect(model.rows[0]?.value).toBeCloseTo(20 / 30);
    expect(model.rows[0]?.raw).toBe(20);
  });

  test("residual detection and formatChartValue", () => {
    expect(isResidual("other")).toBe(true);
    expect(isResidual("1:other")).toBe(true);
    expect(isResidual("1")).toBe(false);
    expect(formatChartValue(0.5, true)).toContain("%");
    expect(formatChartValue(12, false)).toBe("12");
  });
});
