import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { scoreLatticeDb } from "./score-lattice";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scoreLatticeDb", () => {
  test("writes nonzero hub_score via tkn DegreeScorer", () => {
    const dir = mkdtempSync(join(tmpdir(), "score-lattice-"));
    dirs.push(dir);
    const filename = join(dir, "lattice.db");
    const lattice = new Lattice({ filename });
    try {
      lattice.commitFeedBatch(
        [
          { key: "a|", sequence: ["a"] },
          { key: "b|", sequence: ["b"] },
          { key: "c|", sequence: ["c"] },
        ],
        [
          ["a|", "b|", 1],
          ["a|", "c|", 1],
        ],
      );
    } finally {
      lattice.close();
    }
    const before = new Database(filename, { readonly: true });
    try {
      const n = before
        .query<{ n: number }, []>("SELECT count(*) n FROM nodes WHERE hub_score != 0")
        .get()?.n;
      expect(n).toBe(0);
    } finally {
      before.close();
    }
    const { scored } = scoreLatticeDb(filename);
    expect(scored).toBeGreaterThan(0);
  });
});
