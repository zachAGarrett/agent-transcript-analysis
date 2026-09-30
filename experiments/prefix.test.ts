import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { ExperimentPipeline } from "./pipeline";
import { predictNextPatterns } from "./prefix";
import type { Sequence } from "./producers";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("predictNextPatterns", () => {
  test("reports exact next-source-symbol hit@k metrics on held-out prefixes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-prefix-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    try {
      const pipeline = new ExperimentPipeline(lattice);
      const train: Sequence[] = [
        { id: "t0", symbols: ["A|", "B|", "C|"] },
        { id: "t1", symbols: ["A|", "B|", "C|"] },
        { id: "t2", symbols: ["A|", "B|", "D|"] },
      ];
      for (const sequence of train) await pipeline.processOne(sequence);
      lattice.getTopTokens(1);

      const holdout: Sequence[] = [{ id: "h0", symbols: ["A|", "B|", "C|"] }];
      const { metrics, predictions } = predictNextPatterns(lattice, pipeline, holdout, {
        topK: 5,
      });
      expect(metrics.prefixes).toBeGreaterThan(0);
      expect(metrics.coverage).toBeGreaterThan(0);
      expect(metrics.mrr).toBeGreaterThanOrEqual(0);
      expect(metrics.hitAt10).toBeGreaterThanOrEqual(0);
      expect(typeof metrics.softPrefixHitRate).toBe("number");
      // Hard targets are exact source symbols, not pattern-prefix soft matches.
      for (const p of predictions) {
        expect(p.actualNextSymbol === null || p.actualNextSymbol.endsWith("|")).toBe(true);
        if (p.hitAt !== null) {
          expect(p.ranked.some((r) => r.symbol === p.actualNextSymbol)).toBe(true);
        }
      }
    } finally {
      lattice.close();
    }
  });

  test("includes prefix length equal to maxPrefix when a next symbol exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-prefix-max-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    try {
      const pipeline = new ExperimentPipeline(lattice);
      const symbols = ["A|", "B|", "C|", "D|"];
      for (let i = 0; i < 3; i++) {
        await pipeline.processOne({ id: `t${i}`, symbols });
      }
      lattice.getTopTokens(1);

      const { predictions } = predictNextPatterns(lattice, pipeline, [{ id: "h0", symbols }], {
        maxPrefix: 3,
        topK: 5,
      });
      expect(predictions.some((p) => p.prefixLen === 3)).toBe(true);
      expect(Math.max(...predictions.map((p) => p.prefixLen))).toBe(3);
    } finally {
      lattice.close();
    }
  });

  test("default topK retrieves candidates through rank 10", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-prefix-topk-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    try {
      const pipeline = new ExperimentPipeline(lattice);
      const nexts = Array.from({ length: 12 }, (_, i) => `${String.fromCharCode(66 + i)}|`);
      const train: Sequence[] = nexts.map((n, i) => ({
        id: `t${i}`,
        symbols: ["A|", n],
      }));
      for (const sequence of train) await pipeline.processOne(sequence);
      lattice.getTopTokens(1);

      const { predictions, metrics } = predictNextPatterns(lattice, pipeline, [
        { id: "h0", symbols: ["A|", "B|"] },
      ]);
      expect(predictions[0]?.ranked.length).toBe(10);
      expect(metrics.prefixes).toBe(predictions.length);
      expect(metrics.hitAt1).toBeGreaterThanOrEqual(0);
      expect(metrics.mrr).toBeGreaterThanOrEqual(0);
      expect(metrics.coverage).toBeGreaterThanOrEqual(0);
    } finally {
      lattice.close();
    }
  });
});
