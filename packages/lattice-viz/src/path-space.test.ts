import { describe, expect, test } from "bun:test";
import {
  compose,
  merge,
  normalize,
  rollup,
  type Summary,
  topWithRemainder,
} from "@workstream/viz-algebra";
import { Grain, Measure, Morphism, Tip, topKName } from "./ids";
import {
  applyPath,
  autoFollowupAfterSelect,
  enabledNames,
  initialPathState,
  morphismByName,
  morphismContracts,
  morphismCriteria,
  morphismDefs,
  parsePathPlan,
  pathSpace,
  revertPathTo,
  visiblePathSteps,
} from "./index";
import { interpretSummary } from "./interpret";
import { patternLengthKey, patternsByLength } from "./pattern-length";
import { presetPaths } from "./presets";

const summary = (values: [string, number][], scope = "run-a"): Summary => ({
  scope,
  grain: Grain.pattern,
  measure: Measure.storedCount,
  bins: values.map(([key, value]) => ({ key, label: key, value, token: key })),
});

describe("composition contracts", () => {
  test("keyed addition has identity, associativity, and commutativity", () => {
    const a = summary([
      ["a", 2],
      ["bb", 9],
    ]);
    const b = summary([
      ["a", 4],
      ["ccc", 6],
    ]);
    const c = summary([["bb", 1]]);
    expect(merge(a, summary([]))).toEqual(a);
    expect(merge(a, b)).toEqual(merge(b, a));
    expect(merge(merge(a, b), c)).toEqual(merge(a, merge(b, c)));
  });
  test("length rollup preserves partition merges and total mass", () => {
    const a = summary([
      ["aa", 8],
      ["b", 2],
    ]);
    const b = summary([
      ["cc", 3],
      ["d", 7],
    ]);
    const byLength = (s: Summary) => rollup(s, "length", (bin) => String(bin.key.length));
    expect(byLength(merge(a, b))).toEqual(merge(byLength(a), byLength(b)));
    const total = compose(byLength, (s) => s.bins.reduce((sum, bin) => sum + bin.value, 0));
    expect(total(merge(a, b))).toBe(20);
  });
  test("top-k plus residual conserves mass", () => {
    const bins = summary([
      ["a", 9],
      ["b", 8],
      ["c", 2],
    ]).bins;
    expect(topWithRemainder(bins, 19, 1).map((bin) => bin.value)).toEqual([9, 10]);
    expect(
      normalize(topWithRemainder(bins, 19, 1), 19).reduce((sum, bin) => sum + bin.fraction, 0),
    ).toBe(1);
  });
  test("patternLengthKey and patternsByLength", () => {
    expect(patternLengthKey({ key: "1", label: "1", value: 1, token: "a|b" })).toBe("1");
    const s: Summary = {
      scope: "run-a",
      grain: Grain.pattern,
      measure: Measure.storedCount,
      bins: [
        { key: "1", label: "#1", value: 10, id: 1, token: "a" },
        { key: "2", label: "#2", value: 3, id: 2, token: "b" },
      ],
    };
    expect(patternsByLength(s, 1).bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(13);
  });
});

describe("path space", () => {
  test("illegal top_k before source is not enabled", () => {
    expect(enabledNames(initialPathState)).not.toContain(Morphism.topK10);
    expect(enabledNames(initialPathState)).toContain(Morphism.loadPatternMass);
  });
  test("rollup then top-k is enabled; top-k then rollup is not", () => {
    const afterLoad = applyPath(initialPathState, Morphism.loadPatternMass);
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain(Morphism.rollupLength);
    expect(enabledNames(afterLoad.state)).toContain(Morphism.topK10);
    const rolled = applyPath(afterLoad.state, Morphism.rollupLength);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(enabledNames(rolled.state)).toContain(Morphism.topK10);
    const topped = applyPath(afterLoad.state, Morphism.topK10);
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(enabledNames(topped.state)).not.toContain(Morphism.rollupLength);
  });
  test("rank_by_length enabled after pattern mass; not after top-k or rollup", () => {
    const afterLoad = applyPath(initialPathState, Morphism.loadPatternMass);
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain(Morphism.rankByLength);
    const ranked = applyPath(afterLoad.state, Morphism.rankByLength);
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(ranked.state.rankedByLength).toBe(true);
    expect(ranked.state.grain).toBe("pattern");
    expect(enabledNames(ranked.state)).toContain(Morphism.topK10);
    expect(enabledNames(ranked.state)).not.toContain(Morphism.rankByLength);
    const topped = applyPath(afterLoad.state, Morphism.topK10);
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(enabledNames(topped.state)).not.toContain(Morphism.rankByLength);
    const rolled = applyPath(afterLoad.state, Morphism.rollupLength);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(enabledNames(rolled.state)).not.toContain(Morphism.rankByLength);
  });
  test("partition_by_length enabled after pattern mass; walk to commit; not after top-k", () => {
    const afterLoad = applyPath(initialPathState, Morphism.loadPatternMass);
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain(Morphism.partitionByLength);
    const partitioned = applyPath(afterLoad.state, Morphism.partitionByLength);
    expect(partitioned.ok).toBe(true);
    if (!partitioned.ok) return;
    expect(partitioned.state.grain).toBe("pattern-by-length");
    expect(partitioned.state.hasTopK).toBe(true);
    expect(enabledNames(partitioned.state)).toContain(Morphism.commit);
    expect(enabledNames(partitioned.state)).not.toContain(Morphism.topK10);
    const committed = applyPath(partitioned.state, Morphism.commit);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.state.tip).toBe(Tip.committed);

    const topped = applyPath(afterLoad.state, Morphism.topK10);
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(enabledNames(topped.state)).not.toContain(Morphism.partitionByLength);
  });
  test("patterns-by-length preset uses partition_by_length", () => {
    expect(presetPaths["patterns-by-length"]?.map((s) => s.name)).toEqual([
      Morphism.loadPatternMass,
      Morphism.partitionByLength,
      Morphism.commit,
    ]);
  });
  test("hub and inflow presets load graph measures", () => {
    expect(presetPaths.hubs?.map((s) => s.name)).toEqual([
      Morphism.loadHub,
      Morphism.topK10,
      Morphism.commit,
    ]);
    expect(presetPaths.inflows?.map((s) => s.name)).toEqual([
      Morphism.loadInDegree,
      Morphism.topK10,
      Morphism.commit,
    ]);
    expect(presetPaths["lengths-by-edge"]?.map((s) => s.name)).toEqual([
      Morphism.loadEdgeWeight,
      Morphism.rollupLength,
      Morphism.commit,
    ]);
  });
  test("edge-weight summary enables length rollup and re_rollup after top-k", () => {
    const afterLoad = applyPath(initialPathState, Morphism.loadEdgeWeight);
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain(Morphism.rollupLength);
    let state = afterLoad.state;
    for (const name of [Morphism.topK10, Morphism.commit] as const) {
      const next = applyPath(state, name);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.state;
    }
    expect(enabledNames(state)).toContain(Morphism.reRollup);
  });
  test("preset paths parse and commit", () => {
    for (const steps of Object.values(presetPaths)) {
      const { plan, state } = parsePathPlan({ steps, runs: ["run-a"] }, ["run-a"]);
      expect(state.tip).toBe(Tip.committed);
      expect(plan.steps.at(-1)?.name).toBe(Morphism.commit);
    }
  });
  test("illegal step list is rejected", () => {
    expect(() =>
      parsePathPlan(
        { steps: [{ name: Morphism.topK10 }, { name: Morphism.commit }], runs: ["run-a"] },
        ["run-a"],
      ),
    ).toThrow(/Illegal step/);
  });
  test("session morphisms are rejected in construction plans", () => {
    expect(() =>
      parsePathPlan(
        {
          steps: [
            { name: Morphism.loadPatternMass },
            { name: Morphism.rollupLength },
            { name: Morphism.commit },
            { name: Morphism.selectBin, params: { runId: "run-a", binKey: "1" } },
          ],
          runs: ["run-a"],
        },
        ["run-a"],
      ),
    ).toThrow(/Session morphism/);
  });

  test("construction plan with drill_length_patterns replays from step params", () => {
    const { state, plan } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rollupLength },
          { name: Morphism.commit },
          { name: Morphism.drillLengthPatterns, params: { limit: 10, lengthKey: "5" } },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(state.grain).toBe("pattern-by-length");
    expect(state.hasSelection).toBe(false);
    expect(plan.steps.at(-1)).toEqual({
      name: Morphism.drillLengthPatterns,
      params: { limit: 10, lengthKey: "5" },
    });
  });
});

describe("follow-up morphisms", () => {
  const sel = {
    runId: "run-a",
    binKey: "2",
    lengthKey: "2",
  };

  test("length commit + select_bin enables drill_length_patterns", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rollupLength },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(enabledNames(state, sel)).toContain(Morphism.selectBin);
    expect(enabledNames(state)).not.toContain(Morphism.drillLengthPatterns);
    const selected = applyPath(state, Morphism.selectBin, sel);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.state.steps).toEqual(state.steps);
    expect(enabledNames(selected.state)).toContain(Morphism.drillLengthPatterns);
    const drilled = applyPath(selected.state, Morphism.drillLengthPatterns);
    expect(drilled.ok).toBe(true);
    if (!drilled.ok) return;
    expect(drilled.state.tip).toBe(Tip.committed);
    expect(drilled.state.hasSelection).toBe(false);
    const drillStep = drilled.state.steps.find((s) => s.name === Morphism.drillLengthPatterns);
    expect(drillStep?.params?.lengthKey).toBe("2");
  });

  test("decode-summary selects do not enable lattice pattern drills", () => {
    const { state: spans } = parsePathPlan(
      {
        steps: [{ name: Morphism.loadDecodeSpans }, { name: Morphism.commit }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const spanSel = applyPath(spans, Morphism.selectBin, sel);
    expect(spanSel.ok).toBe(true);
    if (!spanSel.ok) return;
    expect(enabledNames(spanSel.state)).not.toContain(Morphism.drillLengthPatterns);
    expect(enabledNames(spanSel.state)).not.toContain(Morphism.openPatternDetail);

    const { state: fallback } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadDecodeFallback },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const fbSel = applyPath(fallback, Morphism.selectBin, {
      runId: "run-a",
      binKey: "atomic",
    });
    expect(fbSel.ok).toBe(true);
    if (!fbSel.ok) return;
    expect(enabledNames(fbSel.state)).not.toContain(Morphism.reRollup);
    expect(enabledNames(fbSel.state)).not.toContain(Morphism.drillLengthPatterns);
    expect(enabledNames(fbSel.state)).not.toContain(Morphism.openPatternDetail);
  });

  test("pattern-by-length select enables detail, not another drill", () => {
    const { state: committed } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rollupLength },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const lengthSel = applyPath(committed, Morphism.selectBin, sel);
    expect(lengthSel.ok).toBe(true);
    if (!lengthSel.ok) return;
    const drilled = applyPath(lengthSel.state, Morphism.drillLengthPatterns);
    expect(drilled.ok).toBe(true);
    if (!drilled.ok) return;
    expect(drilled.state.grain).toBe("pattern-by-length");
    const patternSel = {
      runId: "run-a",
      binKey: "2:1",
      patternId: 1,
      lengthKey: "2",
    };
    const selected = applyPath(drilled.state, Morphism.selectBin, patternSel);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.state.steps).toEqual(drilled.state.steps);
    expect(enabledNames(selected.state)).toContain(Morphism.openPatternDetail);
    expect(enabledNames(selected.state)).not.toContain(Morphism.drillLengthPatterns);
    expect(autoFollowupAfterSelect(enabledNames(selected.state))).toBe(Morphism.openPatternDetail);
  });

  test("focus and unfocus pattern are tip-only cycles", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const stepsBefore = state.steps;
    const selected = applyPath(state, Morphism.selectBin, {
      runId: "run-a",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const focused = applyPath(selected.state, Morphism.openPatternDetail);
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(focused.state.detailRequested).toBe(true);
    expect(focused.state.steps).toEqual(stepsBefore);
    const swapped = applyPath(focused.state, Morphism.selectBin, {
      runId: "run-a",
      binKey: "2",
      patternId: 2,
    });
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.state.detailRequested).toBe(false);
    const refocused = applyPath(swapped.state, Morphism.openPatternDetail);
    expect(refocused.ok).toBe(true);
    if (!refocused.ok) return;
    expect(refocused.state.selectionPatternId).toBe(2);
    const closed = applyPath(refocused.state, Morphism.closePatternDetail);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.state.detailRequested).toBe(false);
    expect(closed.state.hasSelection).toBe(true);
    expect(closed.state.steps).toEqual(stepsBefore);
  });

  test("re-select updates tip without growing the plan", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rollupLength },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const first = applyPath(state, Morphism.selectBin, {
      runId: "run-a",
      binKey: "2",
      lengthKey: "2",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = applyPath(first.state, Morphism.selectBin, {
      runId: "run-a",
      binKey: "3",
      lengthKey: "3",
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.state.steps).toEqual(state.steps);
    expect(again.state.selectionBinKey).toBe("3");
  });

  test("autoFollowupAfterSelect prefers drill when enabled on length tip", () => {
    expect(autoFollowupAfterSelect([Morphism.clearSelection, Morphism.drillLengthPatterns])).toBe(
      Morphism.drillLengthPatterns,
    );
    expect(autoFollowupAfterSelect([Morphism.clearSelection, Morphism.openPatternDetail])).toBe(
      Morphism.openPatternDetail,
    );
    expect(autoFollowupAfterSelect([Morphism.clearSelection])).toBeNull();
  });

  test("faceted commit + select enables focus_run", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK10 },
          { name: Morphism.facetRuns },
          { name: Morphism.commit },
        ],
        runs: ["run-a", "run-b"],
      },
      ["run-a", "run-b"],
    );
    const selected = applyPath(state, Morphism.selectBin, {
      runId: "run-b",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(enabledNames(selected.state)).toContain(Morphism.focusRun);
    const focused = applyPath(selected.state, Morphism.focusRun);
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(focused.state.faceted).toBe(false);
    expect(focused.state.tip).toBe(Tip.committed);
    expect(focused.state.steps.some((s) => s.name === Morphism.focusRun)).toBe(true);
  });

  test("pattern top-k commit enables re_rollup without selection", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(enabledNames(state)).toContain(Morphism.reRollup);
    const rolled = applyPath(state, Morphism.reRollup);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.grain).toBe("length");
    expect(rolled.state.hasTopK).toBe(false);
  });

  test("residual selection without length does not enable drill", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rollupLength },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const selected = applyPath(state, Morphism.selectBin, {
      runId: "run-a",
      binKey: "other",
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(enabledNames(selected.state)).not.toContain(Morphism.drillLengthPatterns);
  });

  test("decode and encode morphisms are removed", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(enabledNames(state)).not.toContain("decode");
    expect(enabledNames(state)).not.toContain("encode");
    expect(pathSpace.transitions.some((t) => t.name === "decode")).toBe(false);
    expect(pathSpace.transitions.some((t) => t.name === "encode")).toBe(false);
  });
});

describe("morphism contracts", () => {
  test("every definition compiles to exactly one transition; projections share names", () => {
    const defNames = morphismDefs.map((d) => d.name).sort();
    const transitionNames = pathSpace.transitions.map((t) => t.name).sort();
    expect(transitionNames).toEqual(defNames);
    expect(Object.keys(morphismCriteria).sort()).toEqual(defNames);
    expect(Object.keys(morphismContracts).sort()).toEqual(defNames);
    expect([...morphismByName.keys()].sort()).toEqual(defNames);
    expect(pathSpace.transitions).toHaveLength(morphismDefs.length);
  });

  test("enabledNames / applyPath parity across load, display, session, reload paths", () => {
    expect(enabledNames(initialPathState)).toContain(Morphism.loadPatternMass);
    const loaded = applyPath(initialPathState, Morphism.loadPatternMass);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    expect(enabledNames(loaded.state)).toContain(Morphism.topK10);
    const displayed = applyPath(loaded.state, Morphism.topK10);
    expect(displayed.ok).toBe(true);
    if (!displayed.ok) return;

    const committed = applyPath(displayed.state, Morphism.commit);
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;

    expect(enabledNames(committed.state)).toContain(Morphism.reRollup);
    const sel = { runId: "run-a", binKey: "1", patternId: 1 };
    expect(enabledNames(committed.state, sel)).toContain(Morphism.selectBin);
    const selected = applyPath(committed.state, Morphism.selectBin, sel);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.state.tip).toBe(Tip.selected);

    const rolled = applyPath(committed.state, Morphism.reRollup);
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.grain).toBe("length");
    expect(rolled.state.hasTopK).toBe(false);
  });

  test("every transition has a contract and criteria entry", () => {
    for (const transition of pathSpace.transitions) {
      expect(morphismContracts[transition.name]).toBeDefined();
      const criteria = morphismCriteria[transition.name];
      expect(criteria).toBeDefined();
      expect(criteria?.label.length).toBeGreaterThan(0);
    }
  });

  test("reload morphisms are marked; re_rollup reloads full pattern bins", () => {
    expect(morphismContracts.re_rollup?.reload).toBe(true);
    expect(morphismContracts.drill_length_patterns?.reload).toBe(true);
    expect(morphismContracts.partition_by_length?.reload).toBe(true);
    expect(morphismContracts.rank_by_length?.reload).toBeUndefined();

    const bins = [
      { key: "1", label: "#1", value: 100, id: 1, token: "a" },
      { key: "2", label: "#2", value: 5, id: 2, token: "b|c|d" },
    ];
    const afterTop = interpretSummary(
      [{ name: Morphism.loadPatternMass }, { name: topKName(1), params: { limit: 1 } }],
      bins,
      { mass: 105, nodes: 2, edgeWeight: 0, hubScore: 0 },
    );
    expect(afterTop.bins.map((b) => b.id ?? b.key)).toEqual([1, "other"]);

    const afterReload = interpretSummary(
      [
        { name: Morphism.loadPatternMass },
        { name: topKName(1), params: { limit: 1 } },
        { name: Morphism.reRollup },
      ],
      bins,
      { mass: 105, nodes: 2, edgeWeight: 0, hubScore: 0 },
    );
    expect(afterReload.bins.some((b) => b.key === "2" && b.value === 5)).toBe(true);
    expect(afterReload.bins.reduce((sum, b) => sum + b.value, 0)).toBe(105);
  });
});

describe("path breadcrumb revert", () => {
  test("revert clears session tip", () => {
    const { plan, state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rankByLength },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const selected = applyPath(state, Morphism.selectBin, {
      runId: "run-a",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const topK = plan.steps.findIndex((s) => s.name === Morphism.topK10);
    const reverted = revertPathTo(selected.state.steps, topK, ["run-a"], ["run-a"]);
    expect(reverted.state.tip).toBe(Tip.committed);
    expect(reverted.state.hasSelection).toBe(false);
    expect(reverted.state.detailRequested).toBe(false);
    expect(visiblePathSteps(reverted.plan.steps).map((v) => v.step.name)).toEqual([
      Morphism.loadPatternMass,
      Morphism.rankByLength,
      Morphism.topK10,
    ]);
  });

  test("revert to top_k auto-commits for a viewable tip", () => {
    const { plan } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.rankByLength },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const topK = plan.steps.findIndex((s) => s.name === Morphism.topK10);
    const reverted = revertPathTo(plan.steps, topK, ["run-a"], ["run-a"]);
    expect(reverted.state.tip).toBe(Tip.committed);
    expect(reverted.state.hasTopK).toBe(true);
    expect(reverted.plan.steps.at(-1)?.name).toBe(Morphism.commit);
  });
});
