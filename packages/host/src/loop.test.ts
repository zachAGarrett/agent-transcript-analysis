import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import type { PreprocessFn } from "./contracts";
import { OnlineLoop } from "./loop";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type FakeMessage = { tag: string | null };

const preprocess: PreprocessFn<FakeMessage> = async (message) => {
  if (message.tag === null) return null;
  return `${message.tag}.|`;
};

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("OnlineLoop", () => {
  test("tags, learns, and decodes a session stream; skips null preprocess", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-loop-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    const loop = new OnlineLoop(preprocess, lattice);

    try {
      const tagged: string[] = [];
      const decodedLens: number[] = [];
      let endedCount: number | null = null;

      for await (const event of loop.run(
        fromArray<FakeMessage>([
          { tag: "a" },
          { tag: null },
          { tag: "b" },
          { tag: "a" },
          { tag: "b" },
        ]),
        { concurrency: 2 },
      )) {
        if (event.kind === "tagged") tagged.push(event.symbol);
        if (event.kind === "decoded") {
          decodedLens.push(event.snapshot.symbols.length);
          expect(event.snapshot.result.complete).toBe(true);
          expect(event.snapshot.symbols.length).toBe(decodedLens.length);
          expect(event.snapshot.decodedStepCount).toBe(event.snapshot.result.steps.length);
        }
        if (event.kind === "sessionEnded") endedCount = event.symbolCount;
      }

      expect(tagged).toEqual(["a.|", "b.|", "a.|", "b.|"]);
      expect(decodedLens).toEqual([1, 2, 3, 4]);
      expect(endedCount).toBe(4);

      const vocab = lattice.vocabulary();
      expect(vocab).toContain("a.|");
      expect(vocab).toContain("b.|");
      const fromA = lattice.getNext("a.|");
      expect(fromA.some((e) => e.to === "b.|")).toBe(true);
    } finally {
      lattice.close();
    }
  });

  test("prequential scoring improves on repeated structure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-loop-learn-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    const loop = new OnlineLoop(preprocess, lattice, { commitBatchSize: 1 });

    try {
      const outcomes: Array<{ hitK: boolean; covered: boolean }> = [];
      const messages = [
        { tag: "a" },
        { tag: "b" },
        { tag: "a" },
        { tag: "b" },
        { tag: "a" },
        { tag: "b" },
      ];
      for await (const event of loop.run(fromArray(messages), { concurrency: 1 })) {
        if (event.kind === "decoded") {
          if (!event.outcome) {
            expect(outcomes.length).toBe(0);
            continue;
          }
          outcomes.push({ hitK: event.outcome.hitK, covered: event.outcome.covered });
        }
      }
      expect(outcomes.length).toBeGreaterThan(0);
      expect(outcomes.some((o) => o.covered)).toBe(true);
    } finally {
      lattice.close();
    }
  });
});
