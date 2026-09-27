import { describe, expect, test } from "bun:test";
import {
  abbreviateAtoms,
  abbreviatePattern,
  decodePatternSteps,
  formatPatternChain,
  patternDisplayLabel,
} from "./decode";

describe("pattern decode / chains", () => {
  test("structured steps for v2-width tokens", () => {
    const token = "1a.-.g.d.10.-.-.|";
    const steps = decodePatternSteps(token);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]?.brief).toBe("explore");
    expect(steps?.[0]?.atoms).toEqual([
      { axis: "who", value: "agent" },
      { axis: "purpose", value: "explore" },
      { axis: "kind", value: "tool" },
      { axis: "tool", value: "Read" },
    ]);
    expect(steps?.[0]?.full).toContain("who:agent");
  });

  test("abbreviation prefers purpose, then intent, then tool", () => {
    expect(
      abbreviateAtoms([
        { axis: "who", value: "agent" },
        { axis: "purpose", value: "explore" },
        { axis: "tool", value: "Read" },
      ]),
    ).toBe("explore");
    expect(
      abbreviateAtoms([
        { axis: "who", value: "user" },
        { axis: "intent", value: "implement" },
      ]),
    ).toBe("implement");
    expect(
      abbreviateAtoms([
        { axis: "who", value: "agent" },
        { axis: "kind", value: "tool" },
        { axis: "tool", value: "Read" },
      ]),
    ).toBe("Read");
  });

  test("middle-truncates chains longer than two steps", () => {
    expect(formatPatternChain(["a", "b"])).toBe("a → b");
    expect(formatPatternChain(["a", "b", "c"])).toBe("a → … → c");
    expect(formatPatternChain(["a", "b", "c", "d"])).toBe("a → … → d");
  });

  test("multi-unit pattern becomes a truncated abbreviated chain", () => {
    const u = "1a.-.g.d.10.-.-.";
    const token = `${u}|${u}|${u}|`;
    expect(abbreviatePattern(token)).toBe("explore → … → explore");
    expect(patternDisplayLabel({ id: 9, key: "9", token })).toBe("explore → … → explore");
  });

  test("undecodable falls back to Pattern #id", () => {
    expect(patternDisplayLabel({ id: 4, key: "4", token: "not-a-token" })).toBe("Pattern #4");
  });
});
