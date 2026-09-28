import { describe, expect, test } from "bun:test";
import {
  compose,
  merge,
  normalize,
  rollup,
  type Summary,
  topWithRemainder,
} from "@workstream/viz-algebra";
import {
  applyPath,
  autoFollowupAfterSelect,
  enabledNames,
  initialPathState,
  morphismContracts,
  morphismCriteria,
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
  grain: "pattern",
  measure: "stored-count",
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
      grain: "pattern",
      measure: "stored-count",
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
    expect(enabledNames(initialPathState)).not.toContain("top_k_10");
    expect(enabledNames(initialPathState)).toContain("load_pattern_mass");
  });
  test("rollup then top-k is enabled; top-k then rollup is not", () => {
    const afterLoad = applyPath(initialPathState, "load_pattern_mass");
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain("rollup_length");
    expect(enabledNames(afterLoad.state)).toContain("top_k_10");
    const rolled = applyPath(afterLoad.state, "rollup_length");
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(enabledNames(rolled.state)).toContain("top_k_10");
    const topped = applyPath(afterLoad.state, "top_k_10");
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(enabledNames(topped.state)).not.toContain("rollup_length");
  });
  test("rank_by_length enabled after pattern mass; not after top-k or rollup", () => {
    const afterLoad = applyPath(initialPathState, "load_pattern_mass");
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain("rank_by_length");
    const ranked = applyPath(afterLoad.state, "rank_by_length");
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) return;
    expect(ranked.state.rankedByLength).toBe(true);
    expect(ranked.state.grain).toBe("pattern");
    expect(enabledNames(ranked.state)).toContain("top_k_10");
    expect(enabledNames(ranked.state)).not.toContain("rank_by_length");
    const topped = applyPath(afterLoad.state, "top_k_10");
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(enabledNames(topped.state)).not.toContain("rank_by_length");
    const rolled = applyPath(afterLoad.state, "rollup_length");
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(enabledNames(rolled.state)).not.toContain("rank_by_length");
  });
  test("partition_by_length enabled after pattern mass; walk to commit; not after top-k", () => {
    const afterLoad = applyPath(initialPathState, "load_pattern_mass");
    expect(afterLoad.ok).toBe(true);
    if (!afterLoad.ok) return;
    expect(enabledNames(afterLoad.state)).toContain("partition_by_length");
    const partitioned = applyPath(afterLoad.state, "partition_by_length");
    expect(partitioned.ok).toBe(true);
    if (!partitioned.ok) return;
    expect(partitioned.state.grain).toBe("pattern-by-length");
    expect(partitioned.state.hasTopK).toBe(true);
    expect(enabledNames(partitioned.state)).toContain("commit");
    expect(enabledNames(partitioned.state)).not.toContain("top_k_10");
    const committed = applyPath(partitioned.state, "commit");
    expect(committed.ok).toBe(true);
    if (!committed.ok) return;
    expect(committed.state.tip).toBe("committed");

    const topped = applyPath(afterLoad.state, "top_k_10");
    expect(topped.ok).toBe(true);
    if (!topped.ok) return;
    expect(enabledNames(topped.state)).not.toContain("partition_by_length");
  });
  test("patterns-by-length preset uses partition_by_length", () => {
    expect(presetPaths["patterns-by-length"]?.map((s) => s.name)).toEqual([
      "load_pattern_mass",
      "partition_by_length",
      "commit",
    ]);
  });
  test("preset paths parse and commit", () => {
    for (const steps of Object.values(presetPaths)) {
      const { plan, state } = parsePathPlan({ steps, runs: ["run-a"] }, ["run-a"]);
      expect(state.tip).toBe("committed");
      expect(plan.steps.at(-1)?.name).toBe("commit");
    }
  });
  test("illegal step list is rejected", () => {
    expect(() =>
      parsePathPlan({ steps: [{ name: "top_k_10" }, { name: "commit" }], runs: ["run-a"] }, [
        "run-a",
      ]),
    ).toThrow(/Illegal step/);
  });
  test("session morphisms are rejected in construction plans", () => {
    expect(() =>
      parsePathPlan(
        {
          steps: [
            { name: "load_pattern_mass" },
            { name: "rollup_length" },
            { name: "commit" },
            { name: "select_bin", params: { runId: "run-a", binKey: "1" } },
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
          { name: "load_pattern_mass" },
          { name: "rollup_length" },
          { name: "commit" },
          { name: "drill_length_patterns", params: { limit: 10, lengthKey: "5" } },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(state.grain).toBe("pattern-by-length");
    expect(state.hasSelection).toBe(false);
    expect(plan.steps.at(-1)).toEqual({
      name: "drill_length_patterns",
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
        steps: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(enabledNames(state, sel)).toContain("select_bin");
    expect(enabledNames(state)).not.toContain("drill_length_patterns");
    const selected = applyPath(state, "select_bin", sel);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.state.steps).toEqual(state.steps);
    expect(enabledNames(selected.state)).toContain("drill_length_patterns");
    const drilled = applyPath(selected.state, "drill_length_patterns");
    expect(drilled.ok).toBe(true);
    if (!drilled.ok) return;
    expect(drilled.state.tip).toBe("committed");
    expect(drilled.state.hasSelection).toBe(false);
    const drillStep = drilled.state.steps.find((s) => s.name === "drill_length_patterns");
    expect(drillStep?.params?.lengthKey).toBe("2");
  });

  test("pattern-by-length select enables detail, not another drill", () => {
    const { state: committed } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const lengthSel = applyPath(committed, "select_bin", sel);
    expect(lengthSel.ok).toBe(true);
    if (!lengthSel.ok) return;
    const drilled = applyPath(lengthSel.state, "drill_length_patterns");
    expect(drilled.ok).toBe(true);
    if (!drilled.ok) return;
    expect(drilled.state.grain).toBe("pattern-by-length");
    const patternSel = {
      runId: "run-a",
      binKey: "2:1",
      patternId: 1,
      lengthKey: "2",
    };
    const selected = applyPath(drilled.state, "select_bin", patternSel);
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(selected.state.steps).toEqual(drilled.state.steps);
    expect(enabledNames(selected.state)).toContain("open_pattern_detail");
    expect(enabledNames(selected.state)).not.toContain("drill_length_patterns");
    expect(autoFollowupAfterSelect(enabledNames(selected.state))).toBe("open_pattern_detail");
  });

  test("focus and unfocus pattern are tip-only cycles", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const stepsBefore = state.steps;
    const selected = applyPath(state, "select_bin", {
      runId: "run-a",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const focused = applyPath(selected.state, "open_pattern_detail");
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(focused.state.detailRequested).toBe(true);
    expect(focused.state.steps).toEqual(stepsBefore);
    const swapped = applyPath(focused.state, "select_bin", {
      runId: "run-a",
      binKey: "2",
      patternId: 2,
    });
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.state.detailRequested).toBe(false);
    const refocused = applyPath(swapped.state, "open_pattern_detail");
    expect(refocused.ok).toBe(true);
    if (!refocused.ok) return;
    expect(refocused.state.selectionPatternId).toBe(2);
    const closed = applyPath(refocused.state, "close_pattern_detail");
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.state.detailRequested).toBe(false);
    expect(closed.state.hasSelection).toBe(true);
    expect(closed.state.steps).toEqual(stepsBefore);
  });

  test("re-select updates tip without growing the plan", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const first = applyPath(state, "select_bin", {
      runId: "run-a",
      binKey: "2",
      lengthKey: "2",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = applyPath(first.state, "select_bin", {
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
    expect(autoFollowupAfterSelect(["clear_selection", "drill_length_patterns"])).toBe(
      "drill_length_patterns",
    );
    expect(autoFollowupAfterSelect(["clear_selection", "open_pattern_detail"])).toBe(
      "open_pattern_detail",
    );
    expect(autoFollowupAfterSelect(["clear_selection"])).toBeNull();
  });

  test("faceted commit + select enables focus_run", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: "load_pattern_mass" },
          { name: "top_k_10" },
          { name: "facet_runs" },
          { name: "commit" },
        ],
        runs: ["run-a", "run-b"],
      },
      ["run-a", "run-b"],
    );
    const selected = applyPath(state, "select_bin", {
      runId: "run-b",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(enabledNames(selected.state)).toContain("focus_run");
    const focused = applyPath(selected.state, "focus_run");
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(focused.state.faceted).toBe(false);
    expect(focused.state.tip).toBe("committed");
    expect(focused.state.steps.some((s) => s.name === "focus_run")).toBe(true);
  });

  test("pattern top-k commit enables re_rollup without selection", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    expect(enabledNames(state)).toContain("re_rollup");
    const rolled = applyPath(state, "re_rollup");
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.grain).toBe("length");
    expect(rolled.state.hasTopK).toBe(false);
  });

  test("residual selection without length does not enable drill", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const selected = applyPath(state, "select_bin", {
      runId: "run-a",
      binKey: "other",
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    expect(enabledNames(selected.state)).not.toContain("drill_length_patterns");
  });

  test("decode and encode morphisms are removed", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
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
      [{ name: "load_pattern_mass" }, { name: "top_k_1", params: { limit: 1 } }],
      bins,
      { mass: 105, nodes: 2, edgeWeight: 0 },
    );
    expect(afterTop.bins.map((b) => b.id ?? b.key)).toEqual([1, "other"]);

    const afterReload = interpretSummary(
      [
        { name: "load_pattern_mass" },
        { name: "top_k_1", params: { limit: 1 } },
        { name: "re_rollup" },
      ],
      bins,
      { mass: 105, nodes: 2, edgeWeight: 0 },
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
          { name: "load_pattern_mass" },
          { name: "rank_by_length" },
          { name: "top_k_10" },
          { name: "commit" },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const selected = applyPath(state, "select_bin", {
      runId: "run-a",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const topK = plan.steps.findIndex((s) => s.name === "top_k_10");
    const reverted = revertPathTo(selected.state.steps, topK, ["run-a"], ["run-a"]);
    expect(reverted.state.tip).toBe("committed");
    expect(reverted.state.hasSelection).toBe(false);
    expect(reverted.state.detailRequested).toBe(false);
    expect(visiblePathSteps(reverted.plan.steps).map((v) => v.step.name)).toEqual([
      "load_pattern_mass",
      "rank_by_length",
      "top_k_10",
    ]);
  });

  test("revert to top_k auto-commits for a viewable tip", () => {
    const { plan } = parsePathPlan(
      {
        steps: [
          { name: "load_pattern_mass" },
          { name: "rank_by_length" },
          { name: "top_k_10" },
          { name: "commit" },
        ],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const topK = plan.steps.findIndex((s) => s.name === "top_k_10");
    const reverted = revertPathTo(plan.steps, topK, ["run-a"], ["run-a"]);
    expect(reverted.state.tip).toBe("committed");
    expect(reverted.state.hasTopK).toBe(true);
    expect(reverted.plan.steps.at(-1)?.name).toBe("commit");
  });
});
