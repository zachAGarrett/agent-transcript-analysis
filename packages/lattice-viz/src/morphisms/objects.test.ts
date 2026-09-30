import { describe, expect, test } from "bun:test";
import { Grain, Morphism, Region, Tip } from "../ids";
import { composeCertifiedPath } from "../path-plan";
import { initialPathState } from "../path-state";
import { presetPaths } from "../presets";
import { classifyPathState, isExecutablePlanRegion, pathObjects, pathRegionKey } from "./objects";
import { applyPath } from "./transitions";

describe("path semantic objects", () => {
  test("catalog wire strings match PathPlan / region vocabulary", () => {
    expect(Morphism.loadPatternMass).toBe("load_pattern_mass");
    expect(Morphism.topK10).toBe("top_k_10");
    expect(Morphism.commit).toBe("commit");
    expect(Region.summaryPattern).toBe("summary.pattern");
    expect(Region.committedPattern).toBe("committed.pattern");
    expect(presetPaths.patterns?.map((s) => s.name)).toEqual([
      "load_pattern_mass",
      "top_k_10",
      "commit",
    ]);
    expect(presetPaths.lengths?.map((s) => s.name)).toEqual([
      "load_pattern_mass",
      "rollup_length",
      "commit",
    ]);
  });

  test("object list keys are unique and cover classifier range", () => {
    const keys = pathObjects.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("initial state is query", () => {
    expect(pathRegionKey(initialPathState)).toBe(Region.query);
    expect(classifyPathState(initialPathState)?.key).toBe(Region.query);
    expect(isExecutablePlanRegion(Region.query)).toBe(true);
  });

  test("load → summary.pattern; top_k → displayed.pattern; commit → committed.pattern", () => {
    const loaded = applyPath(initialPathState, Morphism.loadPatternMass);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(pathRegionKey(loaded.state)).toBe(Region.summaryPattern);

    const topped = applyPath(loaded.state, Morphism.topK10);
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(pathRegionKey(topped.state)).toBe(Region.displayedPattern);

    const committed = applyPath(topped.state, Morphism.commit);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(pathRegionKey(committed.state)).toBe(Region.committedPattern);
  });

  test("rollup → summary.length; selected length is tip-only region", () => {
    const loaded = applyPath(initialPathState, Morphism.loadPatternMass);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const rolled = applyPath(loaded.state, Morphism.rollupLength);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(pathRegionKey(rolled.state)).toBe(Region.summaryLength);

    const committed = applyPath(rolled.state, Morphism.commit);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const sel = applyPath(committed.state, Morphism.selectBin, {
      runId: "r",
      binKey: "1",
      lengthKey: "1",
    });
    expect(sel.ok).toBe(true);
    if (!sel.ok) return;
    expect(pathRegionKey(sel.state)).toBe(Region.selectedLength);
    expect(isExecutablePlanRegion(pathRegionKey(sel.state))).toBe(false);
  });

  test("every preset composes with a valid certificate", () => {
    for (const [name, steps] of Object.entries(presetPaths)) {
      const { state, certificate } = composeCertifiedPath(steps);
      expect(certificate.ok).toBe(true);
      expect(certificate.source).toBe(Tip.query);
      expect(certificate.steps).toEqual(steps.map((s) => s.name));
      expect(state.tip).toBe(Tip.committed);
      expect(certificate.target).toBe(Tip.committed);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("drill plan replay uses lengthKey params without tip manufacture", () => {
    const { state, certificate } = composeCertifiedPath([
      { name: Morphism.loadPatternMass },
      { name: Morphism.rollupLength },
      { name: Morphism.commit },
      { name: Morphism.drillLengthPatterns, params: { lengthKey: "1", limit: 5 } },
    ]);
    expect(certificate.ok).toBe(true);
    expect(state.tip).toBe(Tip.committed);
    expect(state.grain).toBe(Grain.patternByLength);
    expect(pathRegionKey(state)).toBe(Region.committedPatternByLength);
  });
});
