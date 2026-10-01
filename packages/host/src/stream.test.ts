import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PreprocessFn } from "./contracts";
import { openLattice } from "./lattice";
import { createStreamRunner } from "./stream";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Msg = { tag: string | null };

const preprocess: PreprocessFn<Msg> = async (m) => (m.tag === null ? null : `${m.tag}.|`);

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("createStreamRunner", () => {
  test("single stream learns symbols", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-stream-"));
    dirs.push(dir);
    const ref = await openLattice({ kind: "sqlite", filename: join(dir, "lattice.db") });
    try {
      const stream = createStreamRunner({ lattice: ref, preprocess, concurrency: 2 });
      const symbols: string[] = [];
      for await (const event of stream.feed(
        fromArray([{ tag: "a" }, { tag: null }, { tag: "b" }]),
      )) {
        if (event.kind === "tagged") symbols.push(event.symbol);
      }
      await stream.end();
      expect(symbols).toEqual(["a.|", "b.|"]);
      expect(ref.lattice.vocabulary()).toContain("a.|");
      const snap = stream.snapshot();
      expect(snap.symbols.length).toBe(2);
    } finally {
      ref.close();
    }
  });

  test("two streams share lattice vocabulary under runExclusive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-shared-"));
    dirs.push(dir);
    const ref = await openLattice({ kind: "sqlite", filename: join(dir, "lattice.db") });
    try {
      const a = createStreamRunner({ lattice: ref, preprocess, concurrency: 1 });
      const b = createStreamRunner({ lattice: ref, preprocess, concurrency: 1 });

      await Promise.all([
        (async () => {
          for await (const _ of a.feed(fromArray([{ tag: "x" }, { tag: "y" }]))) {
            /* drain */
          }
          await a.end();
        })(),
        (async () => {
          for await (const _ of b.feed(fromArray([{ tag: "y" }, { tag: "z" }]))) {
            /* drain */
          }
          await b.end();
        })(),
      ]);

      const vocab = ref.lattice.vocabulary();
      expect(vocab).toContain("x.|");
      expect(vocab).toContain("y.|");
      expect(vocab).toContain("z.|");
    } finally {
      ref.close();
    }
  });

  test("feed rejects overlapping writers on the same handle", async () => {
    const ref = await openLattice({ kind: "memory" });
    try {
      const stream = createStreamRunner({ lattice: ref, preprocess, concurrency: 1 });
      async function* slow(): AsyncGenerator<Msg> {
        yield { tag: "a" };
        await Bun.sleep(30);
        yield { tag: "b" };
      }
      const first = stream.feed(slow());
      await first.next();
      await expect(async () => {
        for await (const _ of stream.feed(fromArray([{ tag: "c" }]))) {
          /* */
        }
      }).toThrow(/not re-entrant/);
      for await (const _ of first) {
        /* drain */
      }
    } finally {
      ref.close();
    }
  });

  test("ordered preprocess preserves index order under concurrency", async () => {
    const ref = await openLattice({ kind: "memory" });
    try {
      const delays = [40, 10, 25, 5];
      const ordered: PreprocessFn<{ i: number }> = async (item) => {
        await Bun.sleep(delays[item.i] ?? 0);
        return `${item.i}.|`;
      };
      const stream = createStreamRunner({
        lattice: ref,
        preprocess: ordered,
        concurrency: 4,
      });
      const indices: number[] = [];
      for await (const event of stream.feed(fromArray([{ i: 0 }, { i: 1 }, { i: 2 }, { i: 3 }]))) {
        if (event.kind === "tagged") indices.push(event.index);
      }
      expect(indices).toEqual([0, 1, 2, 3]);
    } finally {
      ref.close();
    }
  });
});
