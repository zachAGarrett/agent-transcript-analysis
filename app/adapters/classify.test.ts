import { describe, expect, test } from "bun:test";
import { applyPath, enabledNames, initialPathState, Morphism } from "@workstream/lattice-viz";
import { proposePathRules, rulesPick } from "./classify";

describe("path policy rules", () => {
  test("query tip exposes only sources", () => {
    const names = enabledNames(initialPathState);
    expect(names.every((n) => n.startsWith("load_"))).toBe(true);
    expect(names).toContain(Morphism.loadHub);
    expect(names).toContain(Morphism.loadInDegree);
    expect(names.length).toBeGreaterThan(1);
  });

  test("keyword picks among loads", () => {
    const legal = enabledNames(initialPathState);
    expect(rulesPick("central hub patterns", legal)).toBe(Morphism.loadHub);
    expect(rulesPick("incoming sinks", legal)).toBe(Morphism.loadInDegree);
    expect(rulesPick("outgoing connectivity", legal)).toBe(Morphism.loadEdgeWeight);
    expect(rulesPick("distinct vocabulary", legal)).toBe(Morphism.loadPatternVocab);
    expect(rulesPick("dominant patterns", legal)).toBe(Morphism.loadPatternMass);
  });

  test("longest patterns walks to a committed plan", async () => {
    const result = await proposePathRules("what are the longest patterns?", ["a"]);
    expect(result.plan?.steps.map((s) => s.name)).toEqual([
      Morphism.loadPatternMass,
      Morphism.rankByLength,
      Morphism.topK10,
      Morphism.commit,
    ]);
  });

  test("hub ask walks load_hub → top_k → commit", async () => {
    const result = await proposePathRules("show hub patterns", ["a"]);
    expect(result.plan?.steps.map((s) => s.name)).toEqual([
      Morphism.loadHub,
      Morphism.topK10,
      Morphism.commit,
    ]);
  });

  test("after load, length morphisms compete on the same tip", () => {
    const after = applyPath(initialPathState, Morphism.loadEdgeWeight);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    const legal = enabledNames(after.state);
    expect(legal).toContain(Morphism.rollupLength);
    expect(legal).toContain(Morphism.rankByLength);
    expect(legal).toContain(Morphism.partitionByLength);
  });

  test("onStep receives each forced morphism", async () => {
    const seen: string[] = [];
    await proposePathRules("show hub patterns", ["a"], {
      onStep: (step) => {
        seen.push(step.id);
      },
    });
    expect(seen).toEqual([Morphism.loadHub, Morphism.topK10, Morphism.commit]);
  });

  test("timeline ask succeeds only with runHasEvents", async () => {
    const blocked = await proposePathRules("show timeline scrub", ["a"], undefined, false);
    expect(blocked.plan).toBeNull();

    const opened = await proposePathRules("show timeline scrub", ["a"], undefined, true);
    expect(opened.state?.tip).toBe("timeline");
    expect(opened.plan?.steps).toEqual([]);
    expect(opened.state?.timelineRequested).toBe(true);
  });
});
