import { describe, expect, test } from "bun:test";
import { applyPath, enabledNames, initialPathState } from "@workstream/lattice-viz";
import { proposePathRules, rulesPick } from "./classify";

describe("path policy rules", () => {
  test("query tip exposes only sources", () => {
    const names = enabledNames(initialPathState);
    expect(names.every((n) => n.startsWith("load_"))).toBe(true);
    expect(names).toContain("load_hub");
    expect(names).toContain("load_in_degree");
    expect(names.length).toBeGreaterThan(1);
  });

  test("keyword picks among loads", () => {
    const legal = enabledNames(initialPathState);
    expect(rulesPick("central hub patterns", legal)).toBe("load_hub");
    expect(rulesPick("incoming sinks", legal)).toBe("load_in_degree");
    expect(rulesPick("outgoing connectivity", legal)).toBe("load_edge_weight");
    expect(rulesPick("distinct vocabulary", legal)).toBe("load_pattern_vocab");
    expect(rulesPick("dominant patterns", legal)).toBe("load_pattern_mass");
  });

  test("longest patterns walks to a committed plan", async () => {
    const result = await proposePathRules("what are the longest patterns?", ["a"]);
    expect(result.plan?.steps.map((s) => s.name)).toEqual([
      "load_pattern_mass",
      "rank_by_length",
      "top_k_10",
      "commit",
    ]);
  });

  test("hub ask walks load_hub → top_k → commit", async () => {
    const result = await proposePathRules("show hub patterns", ["a"]);
    expect(result.plan?.steps.map((s) => s.name)).toEqual(["load_hub", "top_k_10", "commit"]);
  });

  test("after load, length morphisms compete on the same tip", () => {
    const after = applyPath(initialPathState, "load_edge_weight");
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const legal = enabledNames(after.state);
    expect(legal).toContain("rollup_length");
    expect(legal).toContain("rank_by_length");
    expect(legal).toContain("partition_by_length");
  });

  test("onStep receives each forced morphism", async () => {
    const seen: string[] = [];
    await proposePathRules("show hub patterns", ["a"], {
      onStep: (step) => {
        seen.push(step.id);
      },
    });
    expect(seen).toEqual(["load_hub", "top_k_10", "commit"]);
  });
});
