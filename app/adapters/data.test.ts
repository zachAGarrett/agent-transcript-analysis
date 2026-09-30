import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChartQuery } from "@/app/viz/chart-query";
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

function q(partial: Partial<ChartQuery> & Pick<ChartQuery, "kind">): ChartQuery {
  return {
    runs: ["run-a"],
    measure: "mass",
    limit: 5,
    normalize: false,
    ...partial,
  };
}

test("bounded top-k conserves full count mass; no node or score writes", async () => {
  const { store, db } = fixture();
  try {
    const before = db.query("SELECT * FROM nodes").all();
    const view = await store.query(q({ kind: "topPatterns", limit: 5 }));
    const facet = view.facets[0];
    expect(facet?.bins.length).toBe(6);
    expect(facet?.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(45);
    const lengths = await store.query(q({ kind: "byLength" }));
    expect(lengths.facets[0]?.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(45);
    const graph = await store.query(q({ kind: "topPatterns", measure: "outgoing", limit: 10 }));
    expect(graph.facets[0]?.bins[0]?.value).toBe(5);
    expect(graph.facets[0]?.total).toBe(6);
    const hubs = await store.query(q({ kind: "topPatterns", measure: "hub", limit: 10 }));
    expect(hubs.facets[0]?.bins[0]?.id).toBe(9);
    expect(hubs.facets[0]?.unit).toBe("hub score");
    const inflows = await store.query(q({ kind: "topPatterns", measure: "incoming", limit: 10 }));
    expect(inflows.facets[0]?.bins.find((b) => b.id === 1)?.value).toBe(3);
    expect(inflows.facets[0]?.total).toBe(6);
    const byEdgeLen = await store.query(q({ kind: "byLength", measure: "outgoing" }));
    expect(byEdgeLen.facets[0]?.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(6);
    expect(db.query("SELECT * FROM nodes").all()).toEqual(before);
  } finally {
    db.close();
  }
});

test("WAL writes invalidate cached views and stale detail requests", async () => {
  const { store, db } = fixture();
  try {
    const patterns = q({ kind: "topPatterns", limit: 5 });
    const first = await store.query(patterns);
    expect((await store.query(patterns)).cacheHit).toBe(true);
    const version = first.facets[0]?.run.version ?? "";
    expect(store.detail("run-a", 9, version).outgoing.total).toBe(5);
    db.run("UPDATE nodes SET token_count=109 WHERE id=9");
    const next = await store.query(patterns);
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
    expect((await store.query(q({ kind: "topPatterns", limit: 5 }))).facets[0]?.total).toBe(0);
    symlinkSync(tmpdir(), join(root, "outside"));
    expect(() => store.version("outside")).toThrow("escaped");
  } finally {
    db.close();
  }
});

test("length drill filters by composite length", async () => {
  const { store, db } = fixture();
  try {
    const view = await store.query(
      q({ kind: "lengthDrill", lengthKey: "2", limit: 10, measure: "mass" }),
    );
    const facet = view.facets[0];
    expect(facet?.bins.every((b) => b.key === "other" || b.token?.split("|").length === 3)).toBe(
      true,
    );
    // token "a|a|" has 2 pipes → length 2
    expect(facet?.bins.some((b) => b.id === 2)).toBe(true);
    // facet total is that length's mass only (id=2 → count 2), not the whole run (45)
    expect(facet?.total).toBe(2);
  } finally {
    db.close();
  }
});

test("length drill residual uses filtered length total, not full run", async () => {
  const { store, db } = fixture();
  try {
    // Seed more length-2 patterns so limit truncates within that length.
    const insert = db.query("INSERT INTO nodes(id,token,token_count,hub_score) VALUES (?,?,?,?)");
    insert.run(10, "b|b|", 7, 0);
    insert.run(11, "c|c|", 4, 0);
    const view = await store.query(
      q({ kind: "lengthDrill", lengthKey: "2", limit: 1, measure: "mass" }),
    );
    const facet = view.facets[0];
    // length-2 mass: id2=2 + id10=7 + id11=4 = 13
    expect(facet?.total).toBe(13);
    expect(facet?.bins[0]?.id).toBe(10);
    expect(facet?.bins[0]?.value).toBe(7);
    const other = facet?.bins.find((b) => b.key === "other");
    expect(other?.value).toBe(6); // 13 - 7, excludes other lengths
    expect(facet?.bins.reduce((s, b) => s + b.value, 0)).toBe(13);
  } finally {
    db.close();
  }
});
