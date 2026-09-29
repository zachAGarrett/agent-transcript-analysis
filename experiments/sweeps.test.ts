import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { ExperimentPipeline } from "./pipeline";
import type { Sequence } from "./producers";
import { evaluateHoldout, mdlComponents, runSweeps } from "./sweeps";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const train: Sequence[] = [
  { id: "s0:t0", symbols: ["A|", "B|", "C|"] },
  { id: "s1:t0", symbols: ["A|", "B|", "D|"] },
  { id: "s2:t0", symbols: ["A|", "B|", "C|"] },
  { id: "s3:t0", symbols: ["A|", "B|", "D|"] },
];

describe("sweeps", () => {
  test("mdlComponents derives encoding and vocabulary costs", () => {
    const parts = mdlComponents({
      sequenceCount: 2,
      completeRate: 1,
      multiSymbolCoverage: 0.5,
      atomicFallbackRate: 0.5,
      meanSpan: 1.5,
      meanSegmentsPerStep: 0.75,
      meanScore: -4,
      meanLatencyMs: 1,
      vocabularySize: 8,
    });
    expect(parts.heldOutEncodingCost).toBe(8);
    expect(parts.vocabularyCost).toBe(3);
  });

  test("evaluateHoldout scores holdout on a trained pipeline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-sweep-eval-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    try {
      const pipeline = new ExperimentPipeline(lattice);
      for (const sequence of train) await pipeline.processOne(sequence);
      lattice.getTopTokens(1);
      const result = evaluateHoldout(pipeline, [train[0]!], {
        name: "viterbi",
        decodeOptions: { mode: "viterbi" },
      });
      expect(result.name).toBe("viterbi");
      expect(result.metrics.sequenceCount).toBe(1);
      expect(result.metrics.completeRate).toBe(1);
    } finally {
      lattice.close();
    }
  });

  test("runSweeps trains one lattice and evaluates each config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-sweep-run-"));
    dirs.push(dir);
    const results = await runSweeps({
      sequences: train,
      holdoutPct: 25,
      seed: 1,
      configs: [
        { name: "viterbi", decodeOptions: { mode: "viterbi" } },
        { name: "beam-4", decodeOptions: { mode: "beam", beamWidth: 4 } },
      ],
      outDir: dir,
    });
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(["viterbi", "beam-4"]);
    const files = readdirSync(dir);
    expect(files).toContain("lattice.db");
    expect(files).toContain("sweeps.json");
    expect(files.filter((f) => f.endsWith(".lattice.db"))).toHaveLength(0);
  });
});
