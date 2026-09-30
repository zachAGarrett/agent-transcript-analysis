import { describe, expect, test } from "bun:test";
import type { Schema } from "@very-coffee/statespace";
import {
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
  required: ["tip", "value", "steps"],
  additionalProperties: false,
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

describe("identity and composition", () => {
  test("identity is a no-op endomorphism", () => {
    const id = identityArrow<Tip, "idle">("idle");
    const result = id.run({ object: "idle", state: idle });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toEqual(idle);
    expect(id.source).toBe(id.target);
  });

  test("compose rejects source/target mismatch", () => {
    const arm = space.arrowOf("arm");
    const finish = space.arrowOf("finish");
    expect(arm).toBeDefined();
    expect(finish).toBeDefined();
    if (!arm || !finish) return;
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

    const armBump = composeArrows([arm, bump]);
    expect(armBump.certificate.ok).toBe(true);
    const leftAssoc = composeArrows([armBump.arrow, finish]);
    const bumpFinish = composeArrows([bump, finish]);
    expect(bumpFinish.certificate.ok).toBe(true);
    const rightAssoc = composeArrows([arm, bumpFinish.arrow]);
    const flat = composeArrows([arm, bump, finish]);
    expect(flat.certificate.ok).toBe(true);
    expect(flat.certificate.steps).toEqual(["arm", "bump", "finish"]);
    expect(flat.certificate.source).toBe("idle");
    expect(flat.certificate.target).toBe("done");

    const start = { object: "idle" as const, state: idle };
    const composed = flat.arrow.run(start);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(leftAssoc.arrow.run(start)).toEqual(composed);
    expect(rightAssoc.arrow.run(start)).toEqual(composed);
    expect(composed.value.state.tip).toBe("done");
    expect(composed.value.state.steps).toEqual(["arm", "bump", "finish"]);
    expect(composed.value.state.value).toBe(1);

    let state = idle;
    for (const name of ["arm", "bump", "finish"] as const) {
      const next = space.apply(state, name);
      expect(next.ok).toBe(true);
      if (!next.ok) return;
      state = next.state;
    }
    expect(state).toEqual(composed.value.state);
  });

  test("identity laws: id ∘ f = f = f ∘ id", () => {
    const arm = space.arrowOf("arm");
    expect(arm).toBeDefined();
    if (!arm) return;
    const idIdle = identityArrow<Tip, "idle">("idle");
    const idReady = identityArrow<Tip, "ready">("ready");
    const leftId = composeArrows([idIdle, arm]);
    const rightId = composeArrows([arm, idReady]);
    expect(leftId.certificate.ok).toBe(true);
    expect(rightId.certificate.ok).toBe(true);
    const start = { object: "idle" as const, state: idle };
    expect(leftId.arrow.run(start)).toEqual(arm.run(start));
    expect(rightId.arrow.run(start)).toEqual(arm.run(start));
  });
});
