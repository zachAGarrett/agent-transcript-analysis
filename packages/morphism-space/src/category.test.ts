import { describe, expect, test } from "bun:test";
import type { Schema } from "@statespace/core";
import {
  checkAndApply,
  composeArrows,
  createMorphismSpace,
  defineMorphisms,
  defineObjects,
  identityArrow,
  objectOf,
} from "./index";

type Tip = { tip: "idle" | "ready" | "done"; value: number; steps: string[] };

const objects = defineObjects<Tip>()([
  { key: "idle", contains: (s) => s.tip === "idle" },
  { key: "ready", contains: (s) => s.tip === "ready" },
  { key: "done", contains: (s) => s.tip === "done" },
]);

const shape = {
  type: "object",
  properties: {
    tip: { type: "string", enum: ["idle", "ready", "done"] },
    value: { type: "number" },
    steps: { type: "array", items: { type: "string" } },
  },
} as unknown as Schema<Tip>;

const defs = defineMorphisms<Tip>()([
  {
    name: "arm",
    phase: "construction",
    criteria: { label: "Arm", what: "idle→ready", not_for: "", examples: [] },
    contract: { domain: "idle", codomain: "ready", source: "idle", target: "ready" },
    available: { when: (s) => s.tip === "idle", otherwise: "Must be idle." },
    effect: (s) => ({ ...s, tip: "ready", steps: [...s.steps, "arm"] }),
  },
  {
    name: "bump",
    phase: "display",
    criteria: { label: "Bump", what: "ready→ready", not_for: "", examples: [] },
    contract: { domain: "ready", codomain: "ready", source: "ready", target: "ready" },
    available: { when: (s) => s.tip === "ready", otherwise: "Must be ready." },
    effect: (s) => ({ ...s, value: s.value + 1, steps: [...s.steps, "bump"] }),
  },
  {
    name: "finish",
    phase: "session",
    criteria: { label: "Finish", what: "ready→done", not_for: "", examples: [] },
    contract: { domain: "ready", codomain: "done", source: "ready", target: "done" },
    available: { when: (s) => s.tip === "ready", otherwise: "Must be ready." },
    effect: (s) => ({ ...s, tip: "done", steps: [...s.steps, "finish"] }),
  },
]);

const space = createMorphismSpace({
  shape,
  effectPath: "tip",
  definitions: defs,
  objects,
});

const idle: Tip = { tip: "idle", value: 0, steps: [] };

describe("semantic objects", () => {
  test("objectOf classifies uniquely", () => {
    expect(objectOf(idle, objects)?.key).toBe("idle");
    expect(objectOf({ tip: "ready", value: 1, steps: [] }, objects)?.key).toBe("ready");
  });

  test("ambiguous contains returns undefined", () => {
    const overlapping = defineObjects<Tip>()([
      { key: "a", contains: () => true },
      { key: "b", contains: () => true },
    ]);
    expect(objectOf(idle, overlapping)).toBeUndefined();
  });
});

describe("checkAndApply", () => {
  test("rejects wrong source region", () => {
    const result = checkAndApply({
      state: idle,
      sourceKey: "ready" as const,
      targetKey: "done" as const,
      objects,
      effect: (s) => ({ ...s, tip: "done" as const }),
    });
    expect(result.ok).toBe(false);
    expect(result.certificate.ok).toBe(false);
  });

  test("rejects target closure failure", () => {
    const result = checkAndApply({
      state: idle,
      sourceKey: "idle" as const,
      targetKey: "ready" as const,
      objects,
      effect: (s) => ({ ...s, tip: "done" as const }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/expected ready/);
  });

  test("succeeds with membership and closure", () => {
    const result = checkAndApply({
      state: idle,
      sourceKey: "idle" as const,
      targetKey: "ready" as const,
      objects,
      effect: (s) => ({ ...s, tip: "ready" as const }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.tip).toBe("ready");
    expect(result.certificate.source).toBe("idle");
    expect(result.certificate.target).toBe("ready");
  });
});

describe("identity and composition", () => {
  test("identity is a no-op endomorphism", () => {
    const id = identityArrow<Tip>("idle");
    const result = id.apply(idle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(idle);
    expect(id.source).toBe(id.target);
  });

  test("compose rejects source/target mismatch", () => {
    const arm = space.arrowOf("arm");
    const finish = space.arrowOf("finish");
    expect(arm).toBeDefined();
    expect(finish).toBeDefined();
    if (!arm || !finish) return;
    // arm: idle→ready, finish: ready→done — composing finish then arm mismatches
    const bad = composeArrows([finish, arm]);
    expect(bad.certificate.ok).toBe(false);
    expect(bad.certificate.error).toMatch(/Cannot compose/);
  });

  test("compose is associative and matches sequential apply", () => {
    const arm = space.arrowOf("arm");
    const bump = space.arrowOf("bump");
    const finish = space.arrowOf("finish");
    expect(arm && bump && finish).toBeTruthy();
    if (!arm || !bump || !finish) return;

    // Nested (arm∘bump)∘finish vs arm∘(bump∘finish) vs flat — same denotation
    const armBump = composeArrows([arm, bump]);
    expect(armBump.certificate.ok).toBe(true);
    const leftAssoc = composeArrows([
      {
        name: "(arm∘bump)",
        source: armBump.certificate.source ?? "idle",
        target: armBump.certificate.target ?? "ready",
        apply: armBump.apply,
      },
      finish,
    ]);
    const bumpFinish = composeArrows([bump, finish]);
    expect(bumpFinish.certificate.ok).toBe(true);
    const rightAssoc = composeArrows([
      arm,
      {
        name: "(bump∘finish)",
        source: bumpFinish.certificate.source ?? "ready",
        target: bumpFinish.certificate.target ?? "done",
        apply: bumpFinish.apply,
      },
    ]);
    const flat = composeArrows([arm, bump, finish]);
    expect(flat.certificate.ok).toBe(true);
    expect(flat.certificate.steps).toEqual(["arm", "bump", "finish"]);
    expect(flat.certificate.source).toBe("idle");
    expect(flat.certificate.target).toBe("done");

    const composed = flat.apply(idle);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(leftAssoc.apply(idle)).toEqual(composed);
    expect(rightAssoc.apply(idle)).toEqual(composed);
    expect(composed.state.tip).toBe("done");
    expect(composed.state.steps).toEqual(["arm", "bump", "finish"]);
    expect(composed.state.value).toBe(1);

    let state = idle;
    for (const name of ["arm", "bump", "finish"] as const) {
      const next = space.apply(state, name);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.state;
    }
    expect(state).toEqual(composed.state);
  });

  test("identity laws: id ∘ f = f = f ∘ id", () => {
    const arm = space.arrowOf("arm");
    expect(arm).toBeDefined();
    if (!arm) return;
    const idIdle = identityArrow<Tip>("idle");
    const idReady = identityArrow<Tip>("ready");
    const leftId = composeArrows([idIdle, arm]);
    const rightId = composeArrows([arm, idReady]);
    expect(leftId.certificate.ok).toBe(true);
    expect(rightId.certificate.ok).toBe(true);
    expect(leftId.apply(idle)).toEqual(arm.apply(idle));
    expect(rightId.apply(idle)).toEqual(arm.apply(idle));
  });
});

describe("createMorphismSpace with objects", () => {
  test("arrowOf projects certified arrows", () => {
    const arm = space.arrowOf("arm");
    expect(arm?.source).toBe("idle");
    expect(arm?.target).toBe("ready");
  });

  test("apply certifies target closure via objects", () => {
    const armed = space.apply(idle, "arm");
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;
    expect(objectOf(armed.state, objects)?.key).toBe("ready");
  });

  test("duplicate object keys throw", () => {
    expect(() =>
      createMorphismSpace({
        shape,
        effectPath: "tip",
        definitions: defs,
        objects: [
          { key: "idle", contains: (s) => s.tip === "idle" },
          { key: "idle", contains: (s) => s.tip === "ready" },
        ],
      }),
    ).toThrow(/Duplicate semantic object key/);
  });
});
