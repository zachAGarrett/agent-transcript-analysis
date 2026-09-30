import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import { LiveDecoder } from "./decoder";
import {
  aggregateOutcomes,
  DecodedContext,
  predictNext,
  projectToSymbols,
  scorePrediction,
} from "./predictor";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempLattice(): Lattice {
  const dir = mkdtempSync(join(tmpdir(), "wt-pred-"));
  dirs.push(dir);
  return new Lattice({ filename: join(dir, "lattice.db") });
}

describe("predictNext", () => {
  test("ranks by transitionLogProb, not raw weight alone", () => {
    const lattice = tempLattice();
    try {
      lattice.commitFeedBatch(
        [
          { key: "A|", sequence: ["A|"] },
          { key: "B|", sequence: ["B|"] },
          { key: "C|", sequence: ["C|"] },
        ],
        [
          ["A|", "B|", 1],
          ["A|", "C|", 10],
        ],
      );
      const compiled = lattice.compile();
      const ranked = predictNext(lattice, compiled, {
        decodedTip: "A|",
        latestSymbol: "A|",
        context: new DecodedContext(),
        topK: 5,
      });
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0]?.pattern).toBe("C|");
      expect(ranked.every((r) => r.prob > 0)).toBe(true);
      const total = ranked.reduce((s, r) => s + r.prob, 0);
      expect(total).toBeCloseTo(1, 5);
    } finally {
      lattice.close();
    }
  });

  test("falls back to atomic tip when decoded tip has no edges", () => {
    const lattice = tempLattice();
    try {
      lattice.commitFeedBatch(
        [
          { key: "A|", sequence: ["A|"] },
          { key: "B|", sequence: ["B|"] },
          { key: "X|Y|", sequence: ["X|", "Y|"] },
        ],
        [["A|", "B|", 2]],
      );
      const compiled = lattice.compile();
      const ranked = predictNext(lattice, compiled, {
        decodedTip: "X|Y|",
        latestSymbol: "A|",
        context: new DecodedContext(),
        topK: 5,
      });
      expect(ranked.some((r) => r.pattern === "B|" && r.source === "atomic")).toBe(true);
    } finally {
      lattice.close();
    }
  });

  test("projects duplicate first-atoms and scores exact symbol hits", () => {
    const lattice = tempLattice();
    try {
      lattice.commitFeedBatch(
        [
          { key: "A|", sequence: ["A|"] },
          { key: "B|", sequence: ["B|"] },
          { key: "B|C|", sequence: ["B|", "C|"] },
        ],
        [
          ["A|", "B|", 1],
          ["A|", "B|C|", 1],
        ],
      );
      const compiled = lattice.compile();
      const ranked = predictNext(lattice, compiled, {
        decodedTip: "A|",
        latestSymbol: "A|",
        context: new DecodedContext(),
        topK: 5,
      });
      const projected = projectToSymbols(ranked);
      const b = projected.find((p) => p.symbol === "B|");
      expect(b).toBeDefined();
      expect((b?.patterns.length ?? 0) >= 1).toBe(true);
      const outcome = scorePrediction(ranked, "B|");
      expect(outcome.hit1 || outcome.hitK).toBe(true);
      expect(outcome.covered).toBe(true);
      expect(outcome.actualSymbol).toBe("B|");
    } finally {
      lattice.close();
    }
  });

  test("trigram context disambiguates identical first-order transitions", () => {
    const lattice = tempLattice();
    try {
      lattice.commitFeedBatch(
        [
          { key: "P|", sequence: ["P|"] },
          { key: "Q|", sequence: ["Q|"] },
          { key: "X|", sequence: ["X|"] },
          { key: "Y|", sequence: ["Y|"] },
        ],
        [
          ["Q|", "X|", 1],
          ["Q|", "Y|", 1],
        ],
      );
      const compiled = lattice.compile();
      const context = new DecodedContext();
      for (let i = 0; i < 8; i++) {
        context.observeTip("P|");
        context.observeTip("Q|");
        context.observeTip("Y|");
      }
      // Land on P,Q context for the forecast tip.
      context.observeTip("P|");
      context.observeTip("Q|");
      expect(context.contextKey()).toBe("P|\0Q|");

      const ranked = predictNext(lattice, compiled, {
        decodedTip: "Q|",
        latestSymbol: "Q|",
        context,
        topK: 5,
      });
      expect(ranked[0]?.pattern).toBe("Y|");
    } finally {
      lattice.close();
    }
  });

  test("uncovered forecasts count as misses in aggregates", () => {
    const metrics = aggregateOutcomes([
      {
        actualSymbol: "A|",
        covered: false,
        rank: null,
        hit1: false,
        hitK: false,
        reciprocalRank: 0,
        softPrefixHit: false,
      },
      {
        actualSymbol: "B|",
        covered: true,
        rank: 1,
        hit1: true,
        hitK: true,
        reciprocalRank: 1,
        softPrefixHit: true,
      },
    ]);
    expect(metrics.trials).toBe(2);
    expect(metrics.hitAt1).toBe(0.5);
    expect(metrics.coverage).toBe(0.5);
  });
});

describe("LiveDecoder context", () => {
  test("pushSymbol observes tip after forecast; snapshot is idempotent", () => {
    const lattice = tempLattice();
    try {
      lattice.commitFeedBatch(
        [
          { key: "A|", sequence: ["A|"] },
          { key: "B|", sequence: ["B|"] },
          { key: "C|", sequence: ["C|"] },
        ],
        [
          ["A|", "B|", 2],
          ["B|", "C|", 2],
        ],
      );
      const decoder = new LiveDecoder(lattice);
      decoder.refresh(lattice.compile());

      decoder.pushSymbol("A|");
      decoder.pushSymbol("B|");
      const afterPush = decoder.context.tips;
      expect(afterPush.previous).toBe("A|");
      expect(afterPush.current).toBe("B|");

      const totalsBefore = decoder.context.contextCount();
      const first = decoder.snapshot();
      const second = decoder.snapshot();
      expect(decoder.context.tips).toEqual(afterPush);
      expect(decoder.context.contextCount()).toBe(totalsBefore);
      expect(first.next.map((n) => n.pattern)).toEqual(second.next.map((n) => n.pattern));
    } finally {
      lattice.close();
    }
  });

  test("resetContext clears tip history", () => {
    const lattice = tempLattice();
    try {
      lattice.commitFeedBatch(
        [
          { key: "A|", sequence: ["A|"] },
          { key: "B|", sequence: ["B|"] },
        ],
        [["A|", "B|", 1]],
      );
      const decoder = new LiveDecoder(lattice);
      decoder.refresh(lattice.compile());
      decoder.pushSymbol("A|");
      decoder.pushSymbol("B|");
      expect(decoder.context.tips.current).toBe("B|");
      decoder.resetContext();
      expect(decoder.context.tips).toEqual({ previous: null, current: null });
      expect(decoder.context.contextKey()).toBeNull();
    } finally {
      lattice.close();
    }
  });
});
