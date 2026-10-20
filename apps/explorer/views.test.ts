import { describe, expect, test } from "bun:test";
import {
  buildChartQuery,
  buildLengthDrillQuery,
  CATEGORY_VIEWS,
  CONN_MEASURES,
  EXPLORER_VIEWS,
  resolveChartMeasure,
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

  test("resolveChartMeasure maps connectivity measure", () => {
    const patterns = CATEGORY_VIEWS.connectivity.charts.find((c) => c.id === "patterns");
    const lengths = CATEGORY_VIEWS.connectivity.charts.find((c) => c.id === "lengths");
    expect(patterns).toBeDefined();
    expect(lengths).toBeDefined();
    if (!patterns || !lengths) return;
    expect(resolveChartMeasure(patterns, "outgoing")).toBe("outgoing");
    expect(resolveChartMeasure(patterns, "incoming")).toBe("incoming");
    expect(resolveChartMeasure(patterns, "hub")).toBe("hub");
    expect(resolveChartMeasure(lengths, "outgoing")).toBe("outgoing");
  });

  test("buildChartQuery applies display knobs to patterns", () => {
    const spec = CATEGORY_VIEWS.lattice.charts.find((c) => c.id === "patterns");
    expect(spec).toBeDefined();
    if (!spec) return;
    const query = buildChartQuery(
      spec,
      { limit: 20, normalized: true, faceted: true },
      ["a", "b"],
      "a",
    );
    expect(query).toMatchObject({
      runs: ["a", "b"],
      kind: "topPatterns",
      measure: "mass",
      limit: 20,
      normalize: true,
    });
  });

  test("buildLengthDrillQuery drills one length with display limit", () => {
    const query = buildLengthDrillQuery(
      "2",
      { limit: 5, normalized: false, faceted: false },
      ["a"],
      "a",
    );
    expect(query).toMatchObject({
      kind: "lengthDrill",
      measure: "mass",
      lengthKey: "2",
      limit: 5,
      runs: ["a"],
    });
  });

  test("buildLengthDrillQuery accepts edge-weight measure", () => {
    const query = buildLengthDrillQuery(
      "1",
      { limit: 10, normalized: false, faceted: false },
      ["a"],
      "a",
      "outgoing",
    );
    expect(query.measure).toBe("outgoing");
    expect(query.lengthKey).toBe("1");
  });

  test("buildChartQuery for byLength incoming", () => {
    const lengths = CATEGORY_VIEWS.connectivity.charts.find((c) => c.id === "lengths");
    expect(lengths).toBeDefined();
    if (!lengths) return;
    const query = buildChartQuery(
      lengths,
      { limit: 10, normalized: false, faceted: false },
      ["a"],
      "a",
      "incoming",
    );
    expect(query).toMatchObject({ kind: "byLength", measure: "incoming", runs: ["a"] });
  });

  test("buildChartQuery overview uses catalogRuns when not faceted", () => {
    const overview = CATEGORY_VIEWS.lattice.charts.find((c) => c.id === "overview");
    expect(overview).toBeDefined();
    if (!overview) return;
    const query = buildChartQuery(
      overview,
      { limit: 10, normalized: false, faceted: false },
      ["a", "b", "c"],
      "a",
    );
    expect(query.runs).toEqual(["a", "b", "c"]);
    expect(query.kind).toBe("overview");
  });
});
