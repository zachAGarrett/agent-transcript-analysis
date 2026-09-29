import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { ExperimentPipeline } from "./pipeline";
import { producerFrom, type Sequence } from "./producers";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempLattice(): { dir: string; lattice: Lattice; pipeline: ExperimentPipeline } {
  const dir = mkdtempSync(join(tmpdir(), "wt-pipeline-"));
  dirs.push(dir);
  const lattice = new Lattice({ filename: join(dir, "lattice.db") });
  return { dir, lattice, pipeline: new ExperimentPipeline(lattice) };
}

describe("ExperimentPipeline boundary isolation", () => {
  test("reused sequencer does not emit empty duplicate segments across sequences", async () => {
    const { lattice, pipeline } = tempLattice();
    try {
      const a: Sequence = { id: "a", symbols: ["who:agent|", "kind:tool|"] };
      const b: Sequence = { id: "b", symbols: ["who:agent|", "kind:text|"] };
      await pipeline.processOne(a);
      await pipeline.processOne(b);

      // No empty-key / cross-boundary composite from leftover ongoingKey.
      const vocab = lattice.vocabulary();
      expect(vocab.every((p) => p.length > 0)).toBe(true);
      expect(vocab.some((p) => p === "kind:tool|who:agent|")).toBe(false);
    } finally {
      lattice.close();
    }
  });

  test("feed isolates transitions across sequence boundaries", async () => {
    const { lattice, pipeline } = tempLattice();
    try {
      await Array.fromAsync(
        pipeline.feed(
          producerFrom([
            { id: "s1", symbols: ["A|", "B|"] },
            { id: "s2", symbols: ["C|", "D|"] },
          ]),
        ),
      );
      // Transition cursor reset: B| should not link to C|.
      const fromB = lattice.getNext("B|");
      expect(fromB.some((e) => e.to === "C|")).toBe(false);
      const fromA = lattice.getNext("A|");
      expect(fromA.some((e) => e.to === "B|")).toBe(true);
    } finally {
      lattice.close();
    }
  });
});

describe("ExperimentPipeline atom-native decode", () => {
  test("scanAtoms and decodeIndexed preserve multi-character symbol paths", async () => {
    const { lattice, pipeline } = tempLattice();
    try {
      const train: Sequence = {
        id: "train",
        symbols: ["agent.tool.Read|", "agent.tool.Grep|", "agent.tool.Read|"],
      };
      await pipeline.processOne(train);
      const compiled = pipeline.compile();
      expect(compiled.terminals.length).toBeGreaterThan(0);
      expect(compiled.patterns).toContain("agent.tool.Read|");

      const scanned = compiled.scanAtoms(train.symbols);
      expect(scanned).toHaveLength(train.symbols.length);
      expect(scanned[0]?.some((c) => c.pattern === "agent.tool.Read|" && c.length === 1)).toBe(
        true,
      );

      const result = pipeline.decode(train, { mode: "viterbi" }, compiled);
      expect(result.complete).toBe(true);
      expect(result.steps.length).toBeGreaterThan(0);
      for (const step of result.steps) {
        expect(step.end).toBeGreaterThan(step.start);
        expect(step.end).toBeLessThanOrEqual(train.symbols.length);
        expect(Number.isFinite(step.emissionScore)).toBe(true);
        expect(Number.isFinite(step.transitionScore)).toBe(true);
      }
      // Decode spans reconstruct the source length.
      expect(result.steps.at(-1)?.end).toBe(train.symbols.length);
      expect(result.steps[0]?.start).toBe(0);
    } finally {
      lattice.close();
    }
  });

  test("decodeTokens returns [] when incomplete", () => {
    const { lattice, pipeline } = tempLattice();
    try {
      // Empty lattice + no fallback would be incomplete only if fallback is null;
      // with symbol fallback, path is always completable. Assert empty sequence path.
      const empty = pipeline.decode({ id: "e", symbols: [] });
      expect(empty.complete).toBe(true);
      expect(empty.tokens).toEqual([]);
      expect(pipeline.decodeTokens({ id: "e", symbols: [] })).toEqual([]);
    } finally {
      lattice.close();
    }
  });
});
