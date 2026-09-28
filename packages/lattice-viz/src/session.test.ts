import { describe, expect, test } from "bun:test";
import {
  applyPath,
  autoFollowupAfterSelect,
  compilePlan,
  enabledNames,
  isUserFollowupChip,
  morphismContracts,
  morphismReloads,
  parsePathPlan,
  planIsOverview,
  planRunsForState,
  selectionContextFromState,
  sessionFromPathState,
  withDisplay,
  withPathState,
} from "./index";

describe("compilePlan display controls", () => {
  test("planIsOverview detects run scalars load", () => {
    expect(
      planIsOverview({ steps: [{ name: "load_run_scalars" }, { name: "commit" }], runs: ["a"] }),
    ).toBe(true);
    expect(
      planIsOverview({
        steps: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
        runs: ["a"],
      }),
    ).toBe(false);
  });

  test("compilePlan inserts normalize and facet before commit", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "top_k_5" }, { name: "commit" }],
        runs: ["a"],
      },
      ["a", "b"],
    );
    const session = withDisplay(sessionFromPathState(state, ["a", "b"], "a"), {
      limit: 10,
      normalized: true,
      faceted: true,
    });
    const next = compilePlan(session);
    expect(next.steps.map((s) => s.name)).toEqual([
      "load_pattern_mass",
      "top_k_10",
      "normalize",
      "facet_runs",
      "commit",
    ]);
    expect(next.runs).toEqual(["a", "b"]);
  });

  test("compilePlan single-run uses selectedRunId; catalog stays intact after focus", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: "load_pattern_mass" },
          { name: "top_k_10" },
          { name: "facet_runs" },
          { name: "commit" },
        ],
        runs: ["a", "b"],
      },
      ["a", "b"],
    );
    let session = sessionFromPathState(state, ["a", "b"], "a");
    const selected = applyPath(state, "select_bin", {
      runId: "b",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const focused = applyPath(selected.state, "focus_run");
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    session = withPathState(session, focused.state, ["b"]);
    expect(session.catalogRuns).toEqual(["a", "b"]);
    expect(session.selectedRunId).toBe("b");
    expect(compilePlan(session).runs).toEqual(["b"]);
    session = withDisplay(session, { faceted: true });
    expect(compilePlan(session).runs).toEqual(["a", "b"]);
  });
});

describe("morphism contract UI flags", () => {
  test("reload and userFollowup flags cover known follow-ups", () => {
    expect(morphismReloads("re_rollup")).toBe(true);
    expect(morphismReloads("drill_length_patterns")).toBe(true);
    expect(morphismReloads("focus_run")).toBe(true);
    expect(morphismReloads("select_bin")).toBe(false);
    expect(morphismReloads("clear_selection")).toBe(false);

    expect(isUserFollowupChip("re_rollup")).toBe(true);
    expect(isUserFollowupChip("clear_selection")).toBe(true);
    expect(isUserFollowupChip("select_bin")).toBe(false);
    expect(isUserFollowupChip("commit")).toBe(false);
    expect(isUserFollowupChip("open_pattern_detail")).toBe(false);
    expect(isUserFollowupChip("close_pattern_detail")).toBe(false);

    for (const name of Object.keys(morphismContracts)) {
      expect(typeof morphismReloads(name)).toBe("boolean");
      expect(typeof isUserFollowupChip(name)).toBe("boolean");
    }
  });

  test("focus_run narrows plan runs from state, not action name", () => {
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
    expect(planRunsForState(selected.state, ["run-a", "run-b"])).toEqual(["run-a", "run-b"]);
    const focused = applyPath(selected.state, "focus_run");
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(planRunsForState(focused.state, ["run-a", "run-b"])).toEqual(["run-b"]);
    expect(selectionContextFromState(focused.state)?.runId).toBe("run-b");
  });

  test("autoFollowupAfterSelect prefers drill then detail", () => {
    expect(autoFollowupAfterSelect(["clear_selection", "focus_run"])).toBe(null);
    expect(autoFollowupAfterSelect(["drill_length_patterns", "open_pattern_detail"])).toBe(
      "drill_length_patterns",
    );
    expect(autoFollowupAfterSelect(["open_pattern_detail", "clear_selection"])).toBe(
      "open_pattern_detail",
    );
  });

  test("length select enables drill only when grain is length", () => {
    const { state } = parsePathPlan(
      {
        steps: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
        runs: ["run-a"],
      },
      ["run-a"],
    );
    const selected = applyPath(state, "select_bin", {
      runId: "run-a",
      binKey: "3",
      lengthKey: "3",
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const enabled = enabledNames(selected.state, selectionContextFromState(selected.state));
    expect(enabled).toContain("drill_length_patterns");
    expect(autoFollowupAfterSelect(enabled)).toBe("drill_length_patterns");
  });
});
