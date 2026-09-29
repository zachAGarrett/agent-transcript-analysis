import { describe, expect, test } from "bun:test";
import type { Bin } from "@workstream/viz-algebra";
import { compileIdentity, compilePath, compileStep } from "./compile";
import { evaluateIR } from "./evaluate-ir";
import { concatIR, emptyIR, irEquals } from "./execution-ir";
import { Morphism, topKName } from "./ids";
import { interpretSummary } from "./interpret";
import { presetPaths } from "./presets";

const bins: Bin[] = [
  { key: "1", label: "#1", value: 100, id: 1, token: "a" },
  { key: "2", label: "#2", value: 50, id: 2, token: "b|c" },
  { key: "3", label: "#3", value: 25, id: 3, token: "d|e|f" },
];
const totals = { mass: 175, nodes: 3, edgeWeight: 0, hubScore: 0 };

describe("interpretation functor", () => {
  test("F(id) = empty IR", () => {
    expect(irEquals(compileIdentity(), emptyIR())).toBe(true);
  });

  test("F(g ∘ f) = F(g) ∘ F(f) for load → top_k → commit", () => {
    const f = compileStep({ name: Morphism.loadPatternMass });
    const g = compileStep({ name: Morphism.topK10 });
    const h = compileStep({ name: Morphism.commit });
    const composed = concatIR(concatIR(f, g), h);
    const { ir, certificate } = compilePath([
      { name: Morphism.loadPatternMass },
      { name: Morphism.topK10 },
      { name: Morphism.commit },
    ]);
    expect(certificate.ok).toBe(true);
    expect(irEquals(ir, composed)).toBe(true);
  });

  test("evaluateIR denotation matches interpretSummary for mass presets", () => {
    const names = ["patterns", "lengths", "patterns-by-length", "overview"] as const;
    for (const name of names) {
      const steps = presetPaths[name];
      expect(steps).toBeDefined();
      if (!steps) continue;
      const viaInterpret = interpretSummary(steps, bins, totals);
      const { ir, certificate } = compilePath(steps);
      expect(certificate.ok).toBe(true);
      const viaIR = evaluateIR(ir, bins, totals);
      expect(viaIR.bins).toEqual(viaInterpret.bins);
      expect(viaIR.total).toEqual(viaInterpret.total);
      expect(viaIR.overview).toEqual(viaInterpret.overview);
    }
  });

  test("rank then top-k uses order-based cut", () => {
    const steps = [
      { name: Morphism.loadPatternMass },
      { name: Morphism.rankByLength },
      { name: topKName(1), params: { limit: 1 } },
    ];
    // Ad-hoc top_k_1 is IR-legal even when not a discrete registry morphism.
    const facet = interpretSummary(steps, bins, totals);
    expect(facet.bins[0]?.id).toBe(3); // longest first
    expect(facet.bins.reduce((s, b) => s + b.value, 0)).toBe(175);
  });

  test("normalize op sets normalized flag without changing bin values", () => {
    const { ir } = compilePath([
      { name: Morphism.loadPatternMass },
      { name: Morphism.topK10 },
      { name: Morphism.normalize },
      { name: Morphism.commit },
    ]);
    const facet = evaluateIR(ir, bins, totals);
    expect(facet.normalized).toBe(true);
    expect(facet.bins.reduce((s, b) => s + b.value, 0)).toBe(175);
  });

  test("session morphisms are rejected by compileStep", () => {
    expect(() => compileStep({ name: Morphism.selectBin })).toThrow(/Session morphism/);
  });
});
