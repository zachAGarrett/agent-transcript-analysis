import { describe, expect, test } from "bun:test";
import type { Bin } from "@workstream/viz-algebra";
import { interpretSummary } from "./interpret";
import { morphismDefs } from "./morphisms/registry";
import { applyPath, enabledNames, SESSION_MORPHISMS } from "./morphisms/transitions";
import { parsePathPlan } from "./path-plan";
import { initialPathState, type PathState } from "./path-state";
import { presetPaths } from "./presets";

const fixtureBins: Bin[] = [
  { key: "1", label: "#1", value: 100, id: 1, token: "a" },
  { key: "2", label: "#2", value: 50, id: 2, token: "b|c" },
  { key: "3", label: "#3", value: 25, id: 3, token: "d|e|f" },
  { key: "4", label: "#4", value: 10, id: 4, token: "g" },
];
const fixtureTotals = { mass: 185, nodes: 4, edgeWeight: 0, hubScore: 0 };

/** Walk enabled names from a tip and assert applyPath parity. */
function assertEnabledApplyParity(state: PathState, context?: unknown) {
  const enabled = enabledNames(state, context);
  for (const name of enabled) {
    const result = applyPath(state, name, context);
    expect(result.ok).toBe(true);
  }
  for (const def of morphismDefs) {
    if (enabled.includes(def.name)) continue;
    const result = applyPath(state, def.name, context);
    expect(result.ok).toBe(false);
  }
}

describe("characterization: enabled/apply parity", () => {
  test("initial tip: every enabled morphism applies; others fail", () => {
    assertEnabledApplyParity(initialPathState);
  });

  test("after load_pattern_mass: parity holds", () => {
    const loaded = applyPath(initialPathState, "load_pattern_mass");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    assertEnabledApplyParity(loaded.state);
  });

  test("after top_k_10 and commit: session select parity", () => {
    let state = initialPathState;
    for (const name of ["load_pattern_mass", "top_k_10", "commit"] as const) {
      const next = applyPath(state, name);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.state;
    }
    assertEnabledApplyParity(state);
    const sel = { runId: "run-a", binKey: "1", patternId: 1 };
    assertEnabledApplyParity(state, sel);
  });
});

describe("characterization: state replay vs interpret", () => {
  test("every preset parses to committed tip without session morphisms", () => {
    for (const [name, steps] of Object.entries(presetPaths)) {
      expect(steps.some((s) => SESSION_MORPHISMS.has(s.name))).toBe(false);
      const { plan, state } = parsePathPlan({ steps, runs: ["run-a"] }, ["run-a"]);
      expect(state.tip).toBe("committed");
      expect(plan.steps.map((s) => s.name)).toEqual(state.steps.map((s) => s.name));
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("construction presets conserve mass under interpretSummary", () => {
    const massPresets = ["patterns", "lengths", "patterns-by-length"] as const;
    for (const name of massPresets) {
      const steps = presetPaths[name];
      expect(steps).toBeDefined();
      if (!steps) continue;
      const facet = interpretSummary(steps, fixtureBins, fixtureTotals);
      expect(facet.overview).toBeUndefined();
      expect(facet.bins.reduce((sum, b) => sum + b.value, 0)).toBe(fixtureTotals.mass);
      expect(facet.total).toBe(fixtureTotals.mass);
    }
  });

  test("overview preset has no pattern bins", () => {
    const steps = presetPaths.overview;
    expect(steps).toBeDefined();
    if (!steps) return;
    const facet = interpretSummary(steps, fixtureBins, fixtureTotals);
    expect(facet.overview).toBe(true);
    expect(facet.bins).toEqual([]);
  });
});

describe("characterization: contract metadata vs executable guards", () => {
  test("every definition has non-empty domain/codomain strings (descriptive today)", () => {
    for (const def of morphismDefs) {
      expect(def.contract.domain.length).toBeGreaterThan(0);
      expect(def.contract.codomain.length).toBeGreaterThan(0);
      expect(def.available.otherwise.length).toBeGreaterThan(0);
    }
  });

  test("session morphisms never append plan steps", () => {
    let state = initialPathState;
    for (const name of ["load_pattern_mass", "top_k_10", "commit"] as const) {
      const next = applyPath(state, name);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.state;
    }
    const planLen = state.steps.length;
    const sel = { runId: "run-a", binKey: "1", patternId: 1 };
    const selected = applyPath(state, "select_bin", sel);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.state.steps.length).toBe(planLen);
    expect(SESSION_MORPHISMS.has("select_bin")).toBe(true);
  });
});
