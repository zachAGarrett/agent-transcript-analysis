import { describe, expect, test } from "bun:test";
import { Morphism } from "./ids";
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
      planIsOverview({
        steps: [{ name: Morphism.loadRunScalars }, { name: Morphism.commit }],
        runs: ["a"],
      }),
    ).toBe(true);
    expect(
      planIsOverview({
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK10 },
          { name: Morphism.commit },
        ],
        runs: ["a"],
      }),
    ).toBe(false);
  });

  test("compilePlan inserts normalize and facet before commit", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK5 },
          { name: Morphism.commit },
        ],
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
      Morphism.loadPatternMass,
      Morphism.topK10,
      Morphism.normalize,
      Morphism.facetRuns,
      Morphism.commit,
    ]);
    expect(next.runs).toEqual(["a", "b"]);
  });

  test("compilePlan single-run uses selectedRunId; catalog stays intact after focus", () => {
    const { state } = parsePathPlan(
      {
        steps: [
          { name: Morphism.loadPatternMass },
          { name: Morphism.topK10 },
          { name: Morphism.facetRuns },
          { name: Morphism.commit },
        ],
        runs: ["a", "b"],
      },
      ["a", "b"],
    );
    let session = sessionFromPathState(state, ["a", "b"], "a");
    const selected = applyPath(state, Morphism.selectBin, {
      runId: "b",
      binKey: "1",
      patternId: 1,
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const focused = applyPath(selected.state, Morphism.focusRun);
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
    expect(morphismReloads(Morphism.reRollup)).toBe(true);
    expect(morphismReloads(Morphism.drillLengthPatterns)).toBe(true);
    expect(morphismReloads(Morphism.focusRun)).toBe(true);
    expect(morphismReloads(Morphism.selectBin)).toBe(false);
    expect(morphismReloads(Morphism.clearSelection)).toBe(false);

    expect(isUserFollowupChip(Morphism.reRollup)).toBe(true);
    expect(isUserFollowupChip(Morphism.clearSelection)).toBe(true);
    expect(isUserFollowupChip(Morphism.selectBin)).toBe(false);
    expect(isUserFollowupChip(Morphism.commit)).toBe(false);
    expect(isUserFollowupChip(Morphism.openPatternDetail)).toBe(false);
    expect(isUserFollowupChip(Morphism.closePatternDetail)).toBe(false);
    expect(isUserFollowupChip(Morphism.openTimelineScrubber)).toBe(true);
    expect(isUserFollowupChip(Morphism.closeTimelineScrubber)).toBe(true);
    expect(isUserFollowupChip(Morphism.showTimelineGraph)).toBe(true);
    expect(isUserFollowupChip(Morphism.showTimelineAccuracy)).toBe(true);
    expect(isUserFollowupChip(Morphism.showTimelineLength)).toBe(true);

    for (const name of Object.keys(morphismContracts)) {
      expect(typeof morphismReloads(name)).toBe("boolean");
      expect(typeof isUserFollowupChip(name)).toBe("boolean");
    }
  });

  test("focus_run narrows plan runs from state, not action name", () => {
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
    expect(planRunsForState(selected.state, ["run-a", "run-b"])).toEqual(["run-a", "run-b"]);
    const focused = applyPath(selected.state, Morphism.focusRun);
    expect(focused.ok).toBe(true);
    if (!focused.ok) return;
    expect(planRunsForState(focused.state, ["run-a", "run-b"])).toEqual(["run-b"]);
    expect(selectionContextFromState(focused.state)?.runId).toBe("run-b");
  });

  test("autoFollowupAfterSelect prefers drill then detail", () => {
    expect(autoFollowupAfterSelect([Morphism.clearSelection, Morphism.focusRun])).toBe(null);
    expect(
      autoFollowupAfterSelect([Morphism.drillLengthPatterns, Morphism.openPatternDetail]),
    ).toBe(Morphism.drillLengthPatterns);
    expect(autoFollowupAfterSelect([Morphism.openPatternDetail, Morphism.clearSelection])).toBe(
      Morphism.openPatternDetail,
    );
  });

  test("length select enables drill only when grain is length", () => {
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
      binKey: "3",
      lengthKey: "3",
    });
    expect(selected.ok).toBe(true);
    if (!selected.ok) return;
    const enabled = enabledNames(selected.state, selectionContextFromState(selected.state));
    expect(enabled).toContain(Morphism.drillLengthPatterns);
    expect(autoFollowupAfterSelect(enabled)).toBe(Morphism.drillLengthPatterns);
  });
});
