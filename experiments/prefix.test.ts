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
  test("reports hit@k metrics on held-out prefixes", async () => {
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
      const { metrics } = predictNextPatterns(lattice, pipeline, holdout, { topK: 5 });
      expect(metrics.prefixes).toBeGreaterThan(0);
      expect(metrics.coverage).toBeGreaterThan(0);
      expect(metrics.mrr).toBeGreaterThanOrEqual(0);
      expect(metrics.hitAt10).toBeGreaterThanOrEqual(0);
    } finally {
      lattice.close();
    }
  });
});
