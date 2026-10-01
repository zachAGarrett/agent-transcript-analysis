import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { OnlineLearner } from "./learner";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempLearner(): { lattice: Lattice; learner: OnlineLearner } {
  const dir = mkdtempSync(join(tmpdir(), "wt-learner-"));
  dirs.push(dir);
  const lattice = new Lattice({ filename: join(dir, "lattice.db") });
  return { lattice, learner: new OnlineLearner(lattice) };
}

describe("OnlineLearner", () => {
  test("ingests multiple symbols without interim endSequence and records transitions", async () => {
    const { lattice, learner } = tempLearner();
    try {
      learner.pushSymbol("A|");
      learner.pushSymbol("B|");
      learner.pushSymbol("C|");
      await learner.endSession();

      const vocab = lattice.vocabulary();
      expect(vocab).toContain("A|");
      expect(vocab).toContain("B|");
      expect(vocab).toContain("C|");

      const fromA = lattice.getNext("A|");
      expect(fromA.some((e) => e.to === "B|")).toBe(true);
      const fromB = lattice.getNext("B|");
      expect(fromB.some((e) => e.to === "C|")).toBe(true);
    } finally {
      lattice.close();
    }
  });

  test("pushSymbol after endSession throws", async () => {
    const { lattice, learner } = tempLearner();
    try {
      learner.pushSymbol("A|");
      await learner.endSession();
      expect(() => learner.pushSymbol("B|")).toThrow(/already ended/);
    } finally {
      lattice.close();
    }
  });

  test("compile exposes patterns learned in-session", async () => {
    const { lattice, learner } = tempLearner();
    try {
      // Repeat so LZ can discover a composite.
      for (const s of ["X|", "Y|", "X|", "Y|", "X|", "Y|"]) {
        learner.pushSymbol(s);
      }
      await learner.endSession();
      const compiled = learner.compile();
      expect(compiled.terminals.length).toBeGreaterThan(0);
      expect(compiled.patterns).toContain("X|");
      expect(compiled.patterns).toContain("Y|");
    } finally {
      lattice.close();
    }
  });

  test("flushes segments to the lattice mid-session at commitBatchSize", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-learner-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    // LZ holds the unmatched tip, so the Nth push emits segment N-1.
    const learner = new OnlineLearner(lattice, { commitBatchSize: 2 });
    try {
      expect(learner.commitBatchSize).toBe(2);
      learner.pushSymbol("A|");
      learner.pushSymbol("B|");
      expect(lattice.vocabulary()).toEqual([]);
      learner.pushSymbol("C|");
      expect(lattice.vocabulary()).toContain("A|");
      expect(lattice.vocabulary()).toContain("B|");
      expect(lattice.vocabulary()).not.toContain("C|");
      await learner.endSession();
      expect(lattice.vocabulary()).toContain("C|");
    } finally {
      lattice.close();
    }
  });

  test("flush makes emitted edges visible below commitBatchSize", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-learner-flush-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    const learner = new OnlineLearner(lattice, { commitBatchSize: 100 });
    try {
      learner.pushSymbol("A|");
      learner.pushSymbol("B|");
      learner.pushSymbol("C|");
      expect(lattice.getNext("A|")).toEqual([]);
      learner.flush();
      expect(lattice.vocabulary()).toContain("A|");
      expect(lattice.vocabulary()).toContain("B|");
      expect(lattice.getNext("A|").some((e) => e.to === "B|")).toBe(true);
    } finally {
      lattice.close();
    }
  });

  test("endSession ingests the unfinished final LZ tip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-learner-end-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    const learner = new OnlineLearner(lattice, { commitBatchSize: 100 });
    try {
      learner.pushSymbol("A|");
      learner.pushSymbol("B|");
      learner.flush();
      await learner.endSession();
      expect(lattice.vocabulary()).toContain("A|");
      expect(lattice.vocabulary()).toContain("B|");
      expect(lattice.getNext("A|").some((e) => e.to === "B|")).toBe(true);
    } finally {
      lattice.close();
    }
  });
});
