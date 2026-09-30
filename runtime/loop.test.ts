import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import type { Atom, Encoder, Encoding } from "@/fixtures/encoders";
import { OnlineLoop } from "./loop";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type FakeMessage = { tag: string | null };

function fakeEncoder(): Encoder<FakeMessage> {
  return {
    taxonomy: [{ axis: "tag", description: "t", classify: async (m) => m.tag }],
    encodeAtom(atom: Atom) {
      return `${atom.split(":")[1] ?? atom}.`;
    },
    async encode(message: FakeMessage): Promise<Encoding> {
      return { atoms: [message.tag === null ? null : `tag:${message.tag}`] };
    },
    compact(atoms: ReadonlyArray<Atom | null>) {
      return `${atoms.map((a) => (a === null ? "-." : `${a.split(":")[1]}.`)).join("")}|`;
    },
  };
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("OnlineLoop", () => {
  test("tags, learns, and decodes a session stream; skips all-null encodings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-loop-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });
    const loop = new OnlineLoop(fakeEncoder(), lattice);

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
    const loop = new OnlineLoop(fakeEncoder(), lattice, { commitBatchSize: 1 });

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
            // First frame has no prior forecast.
            expect(event.snapshot.symbols.length).toBe(1);
          } else {
            outcomes.push({ hitK: event.outcome.hitK, covered: event.outcome.covered });
          }
          // Forecast must not already include the next unseen target as a certainty
          // from learning the current symbol's outgoing edge — outgoing is learned later.
        }
      }
      expect(outcomes.length).toBe(5);
      // Later a→b / b→a repetitions should become covered and often hit.
      const early = outcomes.slice(0, 2);
      const late = outcomes.slice(-2);
      expect(late.every((o) => o.covered)).toBe(true);
      expect(late.filter((o) => o.hitK).length).toBeGreaterThanOrEqual(
        early.filter((o) => o.hitK).length,
      );
    } finally {
      lattice.close();
    }
  });

  test("classify order is preserved under concurrency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-loop-ord-"));
    dirs.push(dir);
    const lattice = new Lattice({ filename: join(dir, "lattice.db") });

    const delays: Record<string, number> = { a: 30, b: 5, c: 15 };
    const encoder: Encoder<FakeMessage> = {
      ...fakeEncoder(),
      async encode(message) {
        await Bun.sleep(delays[message.tag ?? ""] ?? 1);
        return fakeEncoder().encode(message);
      },
    };
    const loop = new OnlineLoop(encoder, lattice);

    try {
      const symbols: string[] = [];
      for await (const event of loop.run(fromArray([{ tag: "a" }, { tag: "b" }, { tag: "c" }]), {
        concurrency: 3,
      })) {
        if (event.kind === "tagged") symbols.push(event.symbol);
      }
      expect(symbols).toEqual(["a.|", "b.|", "c.|"]);
    } finally {
      lattice.close();
    }
  });
});
