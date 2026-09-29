import { describe, expect, test } from "bun:test";
import type { Sequence } from "./producers";
import { sessionIdOf, splitBySession } from "./split";

describe("sessionIdOf", () => {
  test("strips agent-turn suffix", () => {
    expect(sessionIdOf({ id: "abc#0", symbols: [] })).toBe("abc");
    expect(sessionIdOf({ id: "abc#12", symbols: [] })).toBe("abc");
  });

  test("keeps session-span ids", () => {
    expect(sessionIdOf({ id: "abc", symbols: [] })).toBe("abc");
  });
});

describe("splitBySession", () => {
  test("keeps turns of one session on one side", () => {
    const sequences: Sequence[] = [
      { id: "s1#0", symbols: ["a|"] },
      { id: "s1#1", symbols: ["b|"] },
      { id: "s2#0", symbols: ["c|"] },
      { id: "s3#0", symbols: ["d|"] },
      { id: "s4#0", symbols: ["e|"] },
    ];
    const split = splitBySession(sequences, { holdoutPct: 25, seed: 42 });
    const trainSessions = new Set(split.train.map(sessionIdOf));
    const holdoutSessions = new Set(split.holdout.map(sessionIdOf));
    for (const id of trainSessions) expect(holdoutSessions.has(id)).toBe(false);
    // Both turns of s1 stay together if s1 is selected.
    const s1Train = split.train.filter((s) => sessionIdOf(s) === "s1");
    const s1Hold = split.holdout.filter((s) => sessionIdOf(s) === "s1");
    expect(s1Train.length === 0 || s1Train.length === 2).toBe(true);
    expect(s1Hold.length === 0 || s1Hold.length === 2).toBe(true);
  });

  test("is deterministic for a seed", () => {
    const sequences: Sequence[] = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      symbols: ["x|"],
    }));
    const a = splitBySession(sequences, { holdoutPct: 20, seed: 7 });
    const b = splitBySession(sequences, { holdoutPct: 20, seed: 7 });
    expect(a.holdoutSessionIds).toEqual(b.holdoutSessionIds);
    expect(a.trainSessionIds).toEqual(b.trainSessionIds);
  });
});
