import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import type { ChartQuery } from "@/app/viz/chart-query";
import { parseLengthKey, planForQuery, rowsToBins } from "./sqlite-plan";

test("LENGTH_SQL pipe-count via planForQuery byLength", () => {
  const db = new Database(":memory:");
  db.run(
    "CREATE TABLE nodes(id INTEGER PRIMARY KEY, token TEXT, token_count INTEGER, hub_score REAL DEFAULT 0)",
  );
  db.run("INSERT INTO nodes VALUES (1, ?, 1, 0)", ["a|".repeat(40)]);
  const plan = planForQuery({
    runs: ["x"],
    kind: "byLength",
    measure: "mass",
    limit: 10,
    normalize: false,
  });
  const rows = db.query<{ id: number; token: string; value: number }, []>(plan.sql).all();
  expect(rows[0]?.id).toBe(32);
  db.close();
});

test("planForQuery topPatterns and lengthDrill", () => {
  const top: ChartQuery = {
    runs: ["a"],
    kind: "topPatterns",
    measure: "mass",
    limit: 5,
    normalize: false,
  };
  const topPlan = planForQuery(top);
  expect(topPlan.kind).toBe("patterns");
  expect(topPlan.params).toEqual([5]);
  expect(topPlan.sql).toContain("LIMIT ?");

  const drill = planForQuery({
    ...top,
    kind: "lengthDrill",
    lengthKey: "2",
  });
  expect(drill.kind).toBe("filterLength");
  expect(drill.params).toEqual([2, 5]);
});

test("rowsToBins labels patterns", () => {
  const bins = rowsToBins(
    [
      { id: 1, token: "a|", value: 3 },
      { id: 2, token: "b|", value: 1 },
    ],
    "patterns",
    (b) => `P${b.id}`,
  );
  expect(bins[0]).toMatchObject({ key: "1", label: "P1", value: 3 });
});

test("planForQuery lengthDrill includes totalSql for filtered length", () => {
  const drill = planForQuery({
    runs: ["a"],
    kind: "lengthDrill",
    measure: "mass",
    limit: 5,
    normalize: false,
    lengthKey: "2",
  });
  expect(drill.totalSql).toContain("SUM");
  expect(drill.totalParams).toEqual([2]);
});

test("parseLengthKey rejects malformed values", () => {
  expect(() => parseLengthKey(undefined)).toThrow("required");
  expect(() => parseLengthKey("")).toThrow("required");
  expect(() => parseLengthKey("abc")).toThrow("non-negative integer");
  expect(() => parseLengthKey("1.5")).toThrow("non-negative integer");
  expect(() => parseLengthKey("-1")).toThrow("non-negative integer");
  expect(parseLengthKey("0")).toBe(0);
  expect(parseLengthKey("32")).toBe(32);
});

test("planForQuery lengthDrill throws on invalid lengthKey", () => {
  expect(() =>
    planForQuery({
      runs: ["a"],
      kind: "lengthDrill",
      measure: "mass",
      limit: 5,
      normalize: false,
      lengthKey: "NaN",
    }),
  ).toThrow("non-negative integer");
});
