import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canLowerToSql,
  compilePath,
  interpretSummary,
  Morphism,
  optimizeIR,
  type PathPlan,
} from "@workstream/lattice-viz";
import { RunStore } from "./data";
import { LENGTH_SQL, lowerToSqlite } from "./sqlite-plan";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sqlite-plan-test-"));
  roots.push(root);
  mkdirSync(join(root, "run-a"));
  const path = join(root, "run-a", "lattice.db");
  const db = new Database(path);
  db.run(
    "CREATE TABLE nodes(id INTEGER PRIMARY KEY, token TEXT, token_count INTEGER, hub_score REAL DEFAULT 0)",
  );
  db.run("CREATE TABLE edges(from_id INTEGER,to_id INTEGER,weight REAL)");
  const insert = db.query("INSERT INTO nodes(id,token,token_count,hub_score) VALUES (?,?,?,?)");
  for (let id = 1; id <= 9; id++) insert.run(id, "a|".repeat(id), id, 0);
  return { root, db, store: new RunStore(root) };
}

test("LENGTH_SQL matches pipe-count cap used by patternLengthKey", () => {
  const db = new Database(":memory:");
  const token = "a|".repeat(40);
  const row = db
    .query<{ n: number }, [string]>(`SELECT ${LENGTH_SQL} AS n FROM (SELECT ? AS token)`)
    .get(token);
  expect(row?.n).toBe(32);
});

test("SQL lowering and memory agree for top-k mass and length rollup", async () => {
  const { store, db } = fixture();
  try {
    const patterns: PathPlan = {
      steps: [
        { name: Morphism.loadPatternMass },
        { name: Morphism.topK5 },
        { name: Morphism.commit },
      ],
      runs: ["run-a"],
    };
    const { ir } = compilePath(patterns.steps);
    expect(canLowerToSql(optimizeIR(ir))).toBe(true);
    expect(lowerToSqlite(optimizeIR(ir))?.sql).toContain("LIMIT");

    const view = await store.view(patterns);
    const facet = view.facets[0];
    expect(facet?.bins.length).toBe(6);
    expect(facet?.bins.reduce((s, b) => s + b.value, 0)).toBe(45);
    expect(facet?.sql).toContain("LIMIT");

    const lengths: PathPlan = {
      steps: [
        { name: Morphism.loadPatternMass },
        { name: Morphism.rollupLength },
        { name: Morphism.commit },
      ],
      runs: ["run-a"],
    };
    const lengthView = await store.view(lengths);
    const lengthFacet = lengthView.facets[0];
    expect(lengthFacet?.bins.reduce((s, b) => s + b.value, 0)).toBe(45);
    expect(lengthFacet?.sql.toLowerCase()).toContain("group by");

    // Oracle: full load + interpret equals SQL view for patterns
    const rows = db
      .query<{ id: number; token: string; value: number }, []>(
        "SELECT id, token, token_count value FROM nodes",
      )
      .all();
    const bins = rows.map((r) => ({
      key: String(r.id),
      label: `Pattern #${r.id}`,
      value: r.value,
      id: r.id,
      token: r.token,
    }));
    const oracle = interpretSummary(patterns.steps, bins, {
      mass: 45,
      nodes: 9,
      edgeWeight: 0,
      hubScore: 0,
    });
    expect(facet?.bins.map((b) => b.value).sort((a, b) => b - a)).toEqual(
      oracle.bins.map((b) => b.value).sort((a, b) => b - a),
    );
  } finally {
    db.close();
  }
});

test("rank-sensitive paths stay on memory backend", () => {
  const { ir } = compilePath([
    { name: Morphism.loadPatternMass },
    { name: Morphism.rankByLength },
    { name: Morphism.topK5 },
    { name: Morphism.commit },
  ]);
  expect(canLowerToSql(optimizeIR(ir))).toBe(false);
});

test("PatternDetail reports full edge count beyond the LIMIT 12 sample", () => {
  const { store, db } = fixture();
  try {
    db.run("DELETE FROM edges");
    for (let to = 2; to <= 16; to++) {
      if (to > 9) {
        db.run("INSERT INTO nodes(id,token,token_count,hub_score) VALUES (?,?,?,?)", [
          to,
          `x${to}`,
          1,
          0,
        ]);
      }
      db.run("INSERT INTO edges VALUES (?,?,?)", [1, to, 1]);
    }
    const version = store.version("run-a");
    const detail = store.detail("run-a", 1, version);
    expect(detail.outgoing.rows.length).toBe(12);
    expect(detail.outgoing.count).toBe(15);
  } finally {
    db.close();
  }
});
