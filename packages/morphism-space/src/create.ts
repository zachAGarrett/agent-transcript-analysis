import {
  type Path,
  type Schema,
  type StateSpace,
  StateSpaceRepository,
  type Transition,
} from "@statespace/core";
import { type CertifiedArrow, checkAndApply, type SemanticObjectDef } from "./category";
import type {
  ApplyResult,
  MorphismDefinition,
  MorphismInterpret,
  MorphismPhase,
  MorphismSpace,
} from "./types";

/** Loose definition shape for compilation (context/interpret filled by domain packages). */
type AnyDef<TState extends object, TInterpretCtx = unknown, TStep = unknown> = MorphismDefinition<
  TState,
  // biome-ignore lint/suspicious/noExplicitAny: open context slot for domain-typed availability/effects
  any,
  TInterpretCtx,
  TStep,
  string
>;

/**
 * Single apply path: optional categorical membership/target closure, then
 * contextual availability, then effect. Used by both statespace transitions
 * and CertifiedArrow projections so legality is not duplicated.
 */
function runDefApply<TState extends object, TInterpretCtx, TStep>(
  def: AnyDef<TState, TInterpretCtx, TStep>,
  state: TState,
  context: unknown,
  objects: readonly SemanticObjectDef<TState>[] | undefined,
): ApplyResult<TState> {
  const sourceKey = def.contract.source;
  const targetKey = def.contract.target;
  if (objects && sourceKey && targetKey) {
    const certified = checkAndApply({
      state,
      context,
      sourceKey,
      targetKey,
      objects,
      effect: def.effect,
      when: def.available.when,
      otherwise: def.available.otherwise,
    });
    return certified.ok
      ? { ok: true, state: certified.state }
      : { ok: false, error: certified.error, state: certified.state };
  }
  if (!def.available.when(state, context)) {
    return { ok: false, error: def.available.otherwise, state };
  }
  try {
    return { ok: true, state: def.effect(state, context) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "transform failed",
      state,
    };
  }
}

/**
 * Compile availability + effect into a statespace transform.
 * Availability (and optional region certification) runs in the effect so apply
 * context reaches `available.when` and failures surface as apply errors.
 */
function toTransition<TState extends object, TInterpretCtx, TStep>(
  def: AnyDef<TState, TInterpretCtx, TStep>,
  effectPath: Path<TState>,
  objects: readonly SemanticObjectDef<TState>[] | undefined,
): Transition<TState> {
  return {
    name: def.name,
    constraints: [],
    effect: {
      path: effectPath,
      operation: "transform",
      value: (_path, state, context) => {
        const result = runDefApply(def, state as TState, context, objects);
        if (!result.ok) return { success: false, error: result.error };
        return { success: true, state: result.state };
      },
    },
  } as Transition<TState>;
}

/**
 * Compile declarative morphism definitions into a statespace + metadata registry.
 * Duplicate names throw. Literal definition names are preserved on the return type.
 */
export function createMorphismSpace<
  TState extends object,
  TInterpretCtx = unknown,
  TStep = unknown,
  const TDefs extends readonly AnyDef<TState, TInterpretCtx, TStep>[] = readonly AnyDef<
    TState,
    TInterpretCtx,
    TStep
  >[],
>(options: {
  shape: Schema<TState>;
  effectPath: Path<TState>;
  definitions: TDefs;
  objects?: readonly SemanticObjectDef<TState>[];
}): MorphismSpace<TState, unknown, TInterpretCtx, TStep, TDefs> {
  const { shape, effectPath, definitions, objects } = options;
  const seen = new Set<string>();
  for (const def of definitions) {
    if (seen.has(def.name)) {
      throw new Error(`Duplicate morphism name: ${def.name}`);
    }
    seen.add(def.name);
  }

  if (objects) {
    const objectKeys = new Set(objects.map((o) => o.key));
    if (objectKeys.size !== objects.length) {
      throw new Error("Duplicate semantic object key.");
    }
  }

  const byName = new Map(definitions.map((def) => [def.name, def])) as Map<
    TDefs[number]["name"],
    TDefs[number]
  >;

  const criteria = Object.fromEntries(definitions.map((def) => [def.name, def.criteria])) as Record<
    TDefs[number]["name"],
    TDefs[number]["criteria"]
  >;

  const contracts = Object.fromEntries(
    definitions.map((def) => [def.name, def.contract]),
  ) as Record<TDefs[number]["name"], TDefs[number]["contract"]>;

  const transitions = definitions.map((def) => toTransition(def, effectPath, objects));

  const stateSpace: StateSpace<TState> = {
    shape: shape as Schema<TState>,
    transitions,
  };

  let executable: ReturnType<typeof StateSpaceRepository.makeExecutable<TState>> | undefined;
  const getExecutable = () => {
    if (!executable) executable = StateSpaceRepository.makeExecutable(stateSpace);
    return executable;
  };

  const sessionNames = new Set(
    definitions.filter((d) => d.phase === "session").map((d) => d.name),
  ) as Set<TDefs[number]["name"]>;

  const apply = (state: TState, name: string, context?: unknown): ApplyResult<TState> => {
    const result = getExecutable().apply(state, name, context);
    if (result.success) return { ok: true, state: result.state };
    return { ok: false, error: result.error ?? "apply failed", state: result.state };
  };

  const arrowOf = (name: string): CertifiedArrow<TState> | undefined => {
    const def = byName.get(name as TDefs[number]["name"]);
    if (!def) return undefined;
    const source = def.contract.source;
    const target = def.contract.target;
    if (!source || !target) return undefined;
    return {
      name: def.name,
      source,
      target,
      apply: (state, context) => apply(state, def.name, context),
    };
  };

  return {
    definitions,
    byName,
    stateSpace,
    criteria,
    contracts,
    objects,
    arrowOf,
    namesByPhase: (phase: MorphismPhase) =>
      definitions.filter((d) => d.phase === phase).map((d) => d.name) as TDefs[number]["name"][],
    sessionNames,
    label: (name) => criteria[name]?.label ?? String(name),
    what: (name) => criteria[name]?.what,
    reloads: (name) => contracts[name]?.reload === true,
    isUserFollowup: (name) => contracts[name]?.userFollowup !== false,
    enabledNames: (state, context) =>
      getExecutable()
        .enabled(state, context)
        .map((t) => t.name as TDefs[number]["name"]),
    apply,
    interpretOf: (name) =>
      byName.get(name as TDefs[number]["name"])?.interpret as
        | MorphismInterpret<TInterpretCtx, TStep>
        | undefined,
  };
}
