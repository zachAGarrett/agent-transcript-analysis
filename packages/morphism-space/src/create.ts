import {
  type Path,
  type Schema,
  type StateSpace,
  StateSpaceRepository,
  type Transition,
} from "@statespace/core";
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
 * Compile availability + effect into a statespace transform.
 * Availability runs in the effect (not a before_transition constraint) so apply
 * context reaches `available.when` and `otherwise` surfaces as the apply error.
 */
function toTransition<TState extends object, TInterpretCtx, TStep>(
  def: AnyDef<TState, TInterpretCtx, TStep>,
  effectPath: Path<TState>,
): Transition<TState> {
  return {
    name: def.name,
    constraints: [],
    effect: {
      path: effectPath,
      operation: "transform",
      value: (_path, state, context) => {
        const typedState = state as TState;
        if (!def.available.when(typedState, context)) {
          return { success: false, error: def.available.otherwise };
        }
        try {
          const next = def.effect(typedState, context);
          return { success: true, state: next };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "transform failed",
          };
        }
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
}): MorphismSpace<TState, unknown, TInterpretCtx, TStep, TDefs> {
  const { shape, effectPath, definitions } = options;
  const seen = new Set<string>();
  for (const def of definitions) {
    if (seen.has(def.name)) {
      throw new Error(`Duplicate morphism name: ${def.name}`);
    }
    seen.add(def.name);
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

  const transitions = definitions.map((def) => toTransition(def, effectPath));

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

  return {
    definitions,
    byName,
    stateSpace,
    criteria,
    contracts,
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
    apply: (state, name, context): ApplyResult<TState> => {
      const result = getExecutable().apply(state, name, context);
      if (result.success) return { ok: true, state: result.state };
      return { ok: false, error: result.error ?? "apply failed", state: result.state };
    },
    interpretOf: (name) =>
      byName.get(name as TDefs[number]["name"])?.interpret as
        | MorphismInterpret<TInterpretCtx, TStep>
        | undefined,
  };
}
