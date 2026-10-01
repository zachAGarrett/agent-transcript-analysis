import { describe, expect, test } from "bun:test";
import { orderedConcurrentMap } from "./ordered-map";

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("orderedConcurrentMap", () => {
  test("yields results in source order despite staggered completion", async () => {
    const delays = [40, 5, 20, 10, 1];
    const results: number[] = [];
    for await (const value of orderedConcurrentMap(
      fromArray(delays.map((_, i) => i)),
      async (i) => {
        const delay = delays[i] ?? 0;
        await Bun.sleep(delay);
        return i;
      },
      { concurrency: 3 },
    )) {
      results.push(value);
    }
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  test("propagates mapper errors and stops", async () => {
    const seen: number[] = [];
    let threw = false;
    try {
      for await (const value of orderedConcurrentMap(
        fromArray([0, 1, 2]),
        async (i) => {
          if (i === 1) throw new Error("boom");
          await Bun.sleep(5);
          return i;
        },
        { concurrency: 2 },
      )) {
        seen.push(value);
      }
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("boom");
    }
    expect(threw).toBe(true);
    expect(seen).toEqual([0]);
  });

  test("concurrency 1 is sequential", async () => {
    const started: number[] = [];
    const results: number[] = [];
    for await (const value of orderedConcurrentMap(
      fromArray([0, 1, 2]),
      async (i) => {
        started.push(i);
        await Bun.sleep(1);
        return i * 10;
      },
      { concurrency: 1 },
    )) {
      results.push(value);
      // With concurrency 1, next start happens after yield.
      if (results.length === 1) expect(started).toEqual([0]);
    }
    expect(results).toEqual([0, 10, 20]);
  });

  test("early consumer break finalizes the upstream iterator", async () => {
    let returned = false;
    async function* leaky(): AsyncGenerator<number> {
      try {
        yield 0;
        yield 1;
        yield 2;
      } finally {
        returned = true;
      }
    }

    const out: number[] = [];
    for await (const value of orderedConcurrentMap(leaky(), async (i) => i, { concurrency: 2 })) {
      out.push(value);
      if (out.length === 1) break;
    }
    expect(out).toEqual([0]);
    expect(returned).toBe(true);
  });
});
