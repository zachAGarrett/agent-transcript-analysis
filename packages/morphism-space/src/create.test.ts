import { describe, expect, test } from "bun:test";
import type { Schema } from "@very-coffee/statespace";
import { createMorphismSpace, defineMorphisms, defineObjects } from "./index";

type Counter = {
  tip: "idle" | "ready" | "done";
  value: number;
  steps: string[];
};

type Ctx = { delta?: number };

type InterpretCtx = { log: string[] };
type Step = { name: string };

const shape = {
  type: "object",
  properties: {
    tip: { type: "string", enum: ["idle", "ready", "done"] },
    value: { type: "number" },
    steps: { type: "array", items: { type: "string" } },
  },
  required: ["tip", "value", "steps"],
  additionalProperties: false,
} as unknown as Schema<Counter>;

const objects = defineObjects<Counter>()([
  { key: "idle", contains: (s) => s.tip === "idle" },
  { key: "ready", contains: (s) => s.tip === "ready" },
  { key: "done", contains: (s) => s.tip === "done" },
]);

const defs = defineMorphisms<Counter, Ctx, InterpretCtx, Step>()([
  {
    name: "arm",
    phase: "construction",
    criteria: {
      label: "Arm",
      what: "Move idle → ready",
      not_for: "Already armed",
      examples: ["arm"],
    },
    contract: { domain: "idle", codomain: "ready", source: "idle", target: "ready" },
    available: { when: (s) => s.tip === "idle", otherwise: "Must be idle." },
    effect: (s) => ({ ...s, tip: "ready", steps: [...s.steps, "arm"] }),
    interpret: (ctx, step) => ({ log: [...ctx.log, step.name] }),
  },
  {
    name: "bump",
    phase: "display",
    criteria: {
      label: "Bump",
      what: "Add delta to value",
      not_for: "Not ready",
      examples: ["bump"],
    },
    contract: {
      domain: "ready",
      codomain: "ready",
      source: "ready",
      target: "ready",
      reload: true,
    },
    available: {
      when: (s, c) => {
        if (s.tip !== "ready") return false;
        if (c !== undefined) return (c.delta ?? 0) > 0;
        return true;
      },
      otherwise: "Need ready + positive delta.",
    },
    effect: (s, c) => ({ ...s, value: s.value + (c?.delta ?? 0), steps: [...s.steps, "bump"] }),
  },
  {
    name: "finish",
    phase: "session",
    criteria: {
      label: "Finish",
      what: "Close the counter",
      not_for: "Not ready",
      examples: ["finish"],
    },
    contract: {
      domain: "ready",
      codomain: "done",
      source: "ready",
      target: "done",
      userFollowup: false,
    },
    available: { when: (s) => s.tip === "ready", otherwise: "Must be ready." },
    effect: (s) => ({ ...s, tip: "done", steps: [...s.steps, "finish"] }),
  },
]);

const space = createMorphismSpace<Counter, InterpretCtx, Step, typeof defs>({
  shape,
  definitions: defs,
  objects,
});

const initial: Counter = { tip: "idle", value: 0, steps: [] };

describe("createMorphismSpace", () => {
  test("guards reject illegal transitions", () => {
    const bad = space.apply(initial, "finish");
    expect(bad.ok).toBe(false);
    expect(space.enabledNames(initial)).toEqual(["arm"]);
  });

  test("effects and context-sensitive availability", () => {
    const armed = space.apply(initial, "arm");
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;
    expect(armed.state.tip).toBe("ready");
    expect(space.enabledNames(armed.state)).toContain("bump");
    expect(space.enabledNames(armed.state)).toContain("finish");
    expect(space.enabledNames(armed.state, { delta: 0 })).not.toContain("bump");
    expect(space.enabledNames(armed.state, { delta: 2 })).toContain("bump");
    const rejected = space.apply(armed.state, "bump", { delta: 0 });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error).toBe("Need ready + positive delta.");
    const bumped = space.apply(armed.state, "bump", { delta: 3 });
    expect(bumped.ok).toBe(true);
    if (!bumped.ok) return;
    expect(bumped.state.value).toBe(3);
  });

  test("schema rejection on invalid shape", () => {
    const armed = space.apply(initial, "arm");
    expect(armed.ok).toBe(true);
    if (!armed.ok) return;
    const corrupt = { ...armed.state, tip: "nope" as Counter["tip"] };
    const result = space.apply(corrupt, "finish");
    expect(result.ok).toBe(false);
  });

  test("metadata projections share the definition name set", () => {
    const names = defs.map((d) => d.name).sort();
    expect(Object.keys(space.criteria).sort()).toEqual(names);
    expect(Object.keys(space.contracts).sort()).toEqual(names);
    expect([...space.byName.keys()].sort()).toEqual(names);
    expect(space.stateSpace.transitions.map((t) => t.name).sort()).toEqual(names);
    expect(space.namesByPhase("session")).toEqual(["finish"]);
    expect([...space.sessionNames]).toEqual(["finish"]);
    expect(space.label("arm")).toBe("Arm");
    expect(space.what("bump")).toBe("Add delta to value");
    expect(space.reloads("bump")).toBe(true);
    expect(space.reloads("arm")).toBe(false);
    expect(space.isUserFollowup("finish")).toBe(false);
    expect(space.isUserFollowup("arm")).toBe(true);
  });

  test("interpretation lookup", () => {
    const interpret = space.interpretOf("arm");
    expect(interpret).toBeDefined();
    if (!interpret) return;
    const next = interpret({ log: [] }, { name: "arm" });
    expect(next.log).toEqual(["arm"]);
    expect(space.interpretOf("bump")).toBeUndefined();
  });

  test("duplicate names throw at construction", () => {
    expect(() =>
      createMorphismSpace({
        shape,
        objects,
        definitions: defineMorphisms<Counter>()([
          {
            name: "arm",
            phase: "construction",
            criteria: { label: "A", what: "", not_for: "", examples: [] },
            contract: { domain: "a", codomain: "b", source: "idle", target: "ready" },
            available: { when: () => true, otherwise: "" },
            effect: (s) => s,
          },
          {
            name: "arm",
            phase: "session",
            criteria: { label: "B", what: "", not_for: "", examples: [] },
            contract: { domain: "a", codomain: "b", source: "idle", target: "ready" },
            available: { when: () => true, otherwise: "" },
            effect: (s) => s,
          },
        ]),
      }),
    ).toThrow(/Duplicate morphism name: arm/);
  });

  test("multi-source morphisms expand and apply by logical name", () => {
    const multi = createMorphismSpace({
      shape,
      objects,
      definitions: defineMorphisms<Counter>()([
        {
          name: "close",
          phase: "session",
          criteria: { label: "Close", what: "", not_for: "", examples: [] },
          contract: {
            domain: "ready|done",
            codomain: "idle",
            source: "ready",
            target: "idle",
            sources: ["done"],
          },
          available: {
            when: (s) => s.tip === "ready" || s.tip === "done",
            otherwise: "Need ready or done.",
          },
          effect: (s) => ({ ...s, tip: "idle" as const, steps: [...s.steps, "close"] }),
        },
      ]),
    });
    expect(multi.stateSpace.transitions.map((t) => t.name).sort()).toEqual([
      "close@@done",
      "close@@ready",
    ]);
    const fromReady = multi.apply({ tip: "ready", value: 1, steps: [] }, "close");
    expect(fromReady.ok).toBe(true);
    if (!fromReady.ok) return;
    expect(fromReady.state.tip).toBe("idle");
    const fromDone = multi.apply({ tip: "done", value: 1, steps: [] }, "close");
    expect(fromDone.ok).toBe(true);
    expect(multi.enabledNames({ tip: "ready", value: 0, steps: [] })).toEqual(["close"]);
    expect(multi.arrowInstance("close", "ready", "idle")?.name).toBe("close@@ready");
  });

  test("multi-target morphisms instantiate each landing tip", () => {
    const multi = createMorphismSpace({
      shape,
      objects,
      definitions: defineMorphisms<Counter>()([
        {
          name: "branch",
          phase: "session",
          criteria: { label: "Branch", what: "", not_for: "", examples: [] },
          contract: {
            domain: "ready",
            codomain: "idle|done",
            source: "ready",
            target: "idle",
            targets: ["done"],
          },
          available: { when: (s) => s.tip === "ready", otherwise: "Need ready." },
          effect: (s, c) => ({
            ...s,
            tip: (c as { to?: "idle" | "done" } | undefined)?.to === "done" ? "done" : "idle",
            steps: [...s.steps, "branch"],
          }),
        },
      ]),
    });
    expect(multi.stateSpace.transitions.map((t) => t.name).sort()).toEqual([
      "branch@@ready@@done",
      "branch@@ready@@idle",
    ]);
    const toIdle = multi.apply({ tip: "ready", value: 0, steps: [] }, "branch");
    expect(toIdle.ok).toBe(true);
    if (!toIdle.ok) return;
    expect(toIdle.state.tip).toBe("idle");
    const toDone = multi.apply({ tip: "ready", value: 0, steps: [] }, "branch", { to: "done" });
    expect(toDone.ok).toBe(true);
    if (!toDone.ok) return;
    expect(toDone.state.tip).toBe("done");
    expect(multi.arrowInstance("branch", "ready", "done")?.target).toBe("done");
    expect(multi.arrowInstance("branch", "ready", "idle")?.target).toBe("idle");
  });

  test("literal name typing is preserved", () => {
    type Names = (typeof space.definitions)[number]["name"];
    const samples: Names[] = ["arm", "bump", "finish"];
    expect(samples).toContain("arm");
  });
});
