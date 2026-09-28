import { describe, expect, test } from "bun:test";
import { compose, merge, normalize, rollup, type Summary, topWithRemainder } from "./algebra";

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

  test("rejects merge across different scopes, grains, or measures", () => {
    const a = summary([["a", 1]], "run-a");
    const b = summary([["a", 1]], "run-b");
    expect(() => merge(a, b)).toThrow(/facet instead/);
    expect(() => merge(a, { ...a, grain: "length" })).toThrow(/facet instead/);
    expect(() => merge(a, { ...a, measure: "vocabulary" })).toThrow(/facet instead/);
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

  test("top-k rejects when displayed bins exceed total", () => {
    expect(() => topWithRemainder([{ key: "a", label: "a", value: 5 }], 3, 1)).toThrow(
      /exceed the source total/,
    );
  });
});
