import { describe, expect, test } from "bun:test";
import { composeCertifiedPath } from "../path-plan";
import { initialPathState } from "../path-state";
import { presetPaths } from "../presets";
import { classifyPathState, isExecutablePlanRegion, pathObjects, pathRegionKey } from "./objects";
import { applyPath } from "./transitions";

describe("path semantic objects", () => {
  test("object list keys are unique and cover classifier range", () => {
    const keys = pathObjects.map((o) => o.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("initial state is query", () => {
    expect(pathRegionKey(initialPathState)).toBe("query");
    expect(classifyPathState(initialPathState)?.key).toBe("query");
    expect(isExecutablePlanRegion("query")).toBe(true);
  });

  test("load → summary.pattern; top_k → displayed.pattern; commit → committed.pattern", () => {
    const loaded = applyPath(initialPathState, "load_pattern_mass");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(pathRegionKey(loaded.state)).toBe("summary.pattern");

    const topped = applyPath(loaded.state, "top_k_10");
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(pathRegionKey(topped.state)).toBe("displayed.pattern");

    const committed = applyPath(topped.state, "commit");
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(pathRegionKey(committed.state)).toBe("committed.pattern");
  });

  test("rollup → summary.length; selected length is tip-only region", () => {
    const loaded = applyPath(initialPathState, "load_pattern_mass");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const rolled = applyPath(loaded.state, "rollup_length");
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(pathRegionKey(rolled.state)).toBe("summary.length");

    const committed = applyPath(rolled.state, "commit");
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    const sel = applyPath(committed.state, "select_bin", {
      runId: "r",
      binKey: "1",
      lengthKey: "1",
    });
    expect(sel.ok).toBe(true);
    if (!sel.ok) return;
    expect(pathRegionKey(sel.state)).toBe("selected.length");
    expect(isExecutablePlanRegion(pathRegionKey(sel.state))).toBe(false);
  });

  test("every preset composes with a valid certificate", () => {
    for (const [name, steps] of Object.entries(presetPaths)) {
      const { state, certificate } = composeCertifiedPath(steps);
      expect(certificate.ok).toBe(true);
      expect(certificate.source).toBe("query");
      expect(certificate.steps).toEqual(steps.map((s) => s.name));
      expect(state.tip).toBe("committed");
      expect(certificate.target?.startsWith("committed.")).toBe(true);
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("drill plan replay uses lengthKey params without tip manufacture", () => {
    const { state, certificate } = composeCertifiedPath([
      { name: "load_pattern_mass" },
      { name: "rollup_length" },
      { name: "commit" },
      { name: "drill_length_patterns", params: { lengthKey: "1", limit: 5 } },
    ]);
    expect(certificate.ok).toBe(true);
    expect(state.tip).toBe("committed");
    expect(state.grain).toBe("pattern-by-length");
    expect(pathRegionKey(state)).toBe("committed.pattern-by-length");
  });
});
