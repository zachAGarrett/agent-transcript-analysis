import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PathPlan } from "@workstream/lattice-viz";
import { Morphism } from "@workstream/lattice-viz";
import { RunStore } from "./data";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "lattice-explorer-test-"));
  roots.push(root);
  mkdirSync(join(root, "run-a"));
  const path = join(root, "run-a", "lattice.db");
  const db = new Database(path);
  db.run("PRAGMA journal_mode=WAL");
  db.run(
    "CREATE TABLE nodes(id INTEGER PRIMARY KEY, token TEXT, token_count INTEGER, hub_score REAL DEFAULT 0)",
  );
  db.run("CREATE TABLE edges(from_id INTEGER,to_id INTEGER,weight REAL)");
  const insert = db.query("INSERT INTO nodes(id,token,token_count,hub_score) VALUES (?,?,?,?)");
  for (let id = 1; id <= 9; id++) insert.run(id, "a|".repeat(id), id, id === 9 ? Math.log1p(5) : 0);
  db.run("INSERT INTO edges VALUES(9,1,3),(9,2,2),(1,9,1)");
  return { root, db, store: new RunStore(root), path };
}
const patternsPlan: PathPlan = {
  steps: [{ name: Morphism.loadPatternMass }, { name: Morphism.topK5 }, { name: Morphism.commit }],
  runs: ["run-a"],
};
test("bounded top-k conserves full count mass; no node or score writes", async () => {
  const { store, db } = fixture();
  try {
    const before = db.query("SELECT * FROM nodes").all();
    const view = await store.view(patternsPlan);
    const facet = view.facets[0];
    expect(facet?.bins.length).toBe(6);
    expect(facet?.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(45);
    const lengths = await store.view({
      steps: [
        { name: Morphism.loadPatternMass },
        { name: Morphism.rollupLength },
        { name: Morphism.commit },
      ],
      runs: ["run-a"],
    });
    expect(lengths.facets[0]?.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(45);
    const graph = await store.view({
      steps: [
        { name: Morphism.loadEdgeWeight },
        { name: Morphism.topK10 },
        { name: Morphism.commit },
      ],
      runs: ["run-a"],
    });
    expect(graph.facets[0]?.bins[0]?.value).toBe(5);
    expect(graph.facets[0]?.total).toBe(6);
    const hubs = await store.view({
      steps: [{ name: Morphism.loadHub }, { name: Morphism.topK10 }, { name: Morphism.commit }],
      runs: ["run-a"],
    });
    expect(hubs.facets[0]?.bins[0]?.id).toBe(9);
    expect(hubs.facets[0]?.unit).toBe("hub score");
    const inflows = await store.view({
      steps: [
        { name: Morphism.loadInDegree },
        { name: Morphism.topK10 },
        { name: Morphism.commit },
      ],
      runs: ["run-a"],
    });
    expect(inflows.facets[0]?.bins.find((b) => b.id === 1)?.value).toBe(3);
    expect(inflows.facets[0]?.total).toBe(6);
    const byEdgeLen = await store.view({
      steps: [
        { name: Morphism.loadEdgeWeight },
        { name: Morphism.rollupLength },
        { name: Morphism.commit },
      ],
      runs: ["run-a"],
    });
    expect(byEdgeLen.facets[0]?.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(6);
    expect(db.query("SELECT * FROM nodes").all()).toEqual(before);
  } finally {
    db.close();
  }
});
test("WAL writes invalidate cached views and stale detail requests", async () => {
  const { store, db } = fixture();
  try {
    const first = await store.view(patternsPlan);
    expect((await store.view(patternsPlan)).cacheHit).toBe(true);
    const version = first.facets[0]?.run.version ?? "";
    expect(store.detail("run-a", 9, version).outgoing.total).toBe(5);
    db.run("UPDATE nodes SET token_count=109 WHERE id=9");
    const next = await store.view(patternsPlan);
    expect(next.cacheHit).toBe(false);
    expect(next.facets[0]?.total).toBe(145);
    expect(() => store.detail("run-a", 9, version)).toThrow("changed");
  } finally {
    db.close();
  }
});
test("empty run produces finite summaries and external symlinks are rejected", async () => {
  const { store, db, root } = fixture();
  try {
    db.run("DELETE FROM edges");
    db.run("DELETE FROM nodes");
    expect((await store.view(patternsPlan)).facets[0]?.total).toBe(0);
    symlinkSync(tmpdir(), join(root, "outside"));
    expect(() => store.version("outside")).toThrow("escaped");
  } finally {
    db.close();
  }
});
