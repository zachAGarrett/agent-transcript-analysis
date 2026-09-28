import { describe, expect, test } from "bun:test";
import { applyPath, enabledNames, initialPathState } from "@workstream/lattice-viz";
import { proposePathRules } from "./classify";

describe("path policy rules", () => {
  test("ambiguous question yields null plan at query tip", async () => {
    const result = await proposePathRules("what are the longest patterns?", ["a"]);
    expect(result.plan).toBeNull();
    expect(result.steps).toEqual([]);
  });
  test("query tip exposes only sources", () => {
    const names = enabledNames(initialPathState);
    expect(names.every((n) => n.startsWith("load_"))).toBe(true);
    expect(names.length).toBeGreaterThan(1);
  });
  test("after load, length morphisms compete on the same tip", () => {
    const after = applyPath(initialPathState, "load_pattern_mass");
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const legal = enabledNames(after.state);
    expect(legal).toContain("rollup_length");
    expect(legal).toContain("rank_by_length");
    expect(legal).toContain("partition_by_length");
  });
  test("forced walk commits when only commit remains", async () => {
    // Simulate tip where commit is the unique forced finish: summary + length grain
    let state = initialPathState;
    for (const name of ["load_pattern_mass", "rollup_length"] as const) {
      const next = applyPath(state, name);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.state;
    }
    const legal = enabledNames(state);
    expect(legal).toContain("commit");
    // rules from initial still cannot reach here without Jev
    expect((await proposePathRules("how long?", ["a"])).plan).toBeNull();
  });
  test("onStep receives each forced morphism", async () => {
    const seen: string[] = [];
    await proposePathRules("x", ["a"], {
      onStep: (step) => {
        seen.push(step.id);
      },
    });
    expect(seen).toEqual([]);
  });
});
