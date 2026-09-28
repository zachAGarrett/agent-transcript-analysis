import type { Path, Schema, StateSpace } from "@statespace/core";

export type MorphismPhase = "construction" | "display" | "session";

export type MorphismCriteria = {
  label: string;
  what: string;
  not_for: string;
  examples: string[];
};

export type MorphismContract = {
  domain: string;
  codomain: string;
  /** Downstream consumers should reload data after this morphism. */
  reload?: boolean;
  /**
   * When false, hide from user-facing follow-up chips (still legal in enabled /
   * auto-follow). Defaults to true.
   */
  userFollowup?: boolean;
};

export type MorphismAvailability<TState extends object, TContext = unknown> = {
  when: (state: TState, context?: TContext) => boolean;
  otherwise: string;
};

export type MorphismInterpret<TInterpretCtx, TStep> = (
  ctx: TInterpretCtx,
  step: TStep,
) => TInterpretCtx;

/**
 * Declarative morphism definition. Domain packages specialize the generics;
 * interpretation is optional and domain-owned.
 */
export type MorphismDefinition<
  TState extends object,
  TContext = unknown,
  TInterpretCtx = unknown,
  TStep = unknown,
  TName extends string = string,
> = {
  name: TName;
  phase: MorphismPhase;
  criteria: MorphismCriteria;
  contract: MorphismContract;
  available: MorphismAvailability<TState, TContext>;
  effect: (state: TState, context?: TContext) => TState;
  interpret?: MorphismInterpret<TInterpretCtx, TStep>;
};

/** Identity helper that preserves literal morphism name unions. */
export function defineMorphisms<
  TState extends object,
  TContext = unknown,
  TInterpretCtx = unknown,
  TStep = unknown,
>() {
  return <
    const TDefs extends readonly MorphismDefinition<
      TState,
      TContext,
      TInterpretCtx,
      TStep,
      string
    >[],
  >(
    definitions: TDefs,
  ): TDefs => definitions;
}

export type ApplyResult<TState extends object> =
  | { ok: true; state: TState }
  | { ok: false; error: string; state: TState };

export type MorphismSpace<
  TState extends object,
  TContext = unknown,
  TInterpretCtx = unknown,
  TStep = unknown,
  TDefs extends readonly MorphismDefinition<
    TState,
    TContext,
    TInterpretCtx,
    TStep,
    string
  >[] = readonly MorphismDefinition<TState, TContext, TInterpretCtx, TStep, string>[],
> = {
  definitions: TDefs;
  byName: Map<TDefs[number]["name"], TDefs[number]>;
  stateSpace: StateSpace<TState>;
  criteria: Record<TDefs[number]["name"], MorphismCriteria>;
  contracts: Record<TDefs[number]["name"], MorphismContract>;
  namesByPhase: (phase: MorphismPhase) => TDefs[number]["name"][];
  sessionNames: Set<TDefs[number]["name"]>;
  label: (name: TDefs[number]["name"]) => string;
  what: (name: TDefs[number]["name"]) => string | undefined;
  reloads: (name: TDefs[number]["name"]) => boolean;
  isUserFollowup: (name: TDefs[number]["name"]) => boolean;
  enabledNames: (state: TState, context?: TContext) => TDefs[number]["name"][];
  apply: (state: TState, name: string, context?: TContext) => ApplyResult<TState>;
  interpretOf: (name: string) => MorphismInterpret<TInterpretCtx, TStep> | undefined;
};

export type CreateMorphismSpaceOptions<
  TState extends object,
  TContext = unknown,
  TInterpretCtx = unknown,
  TStep = unknown,
  TDefs extends readonly MorphismDefinition<
    TState,
    TContext,
    TInterpretCtx,
    TStep,
    string
  >[] = readonly MorphismDefinition<TState, TContext, TInterpretCtx, TStep, string>[],
> = {
  shape: Schema<TState>;
  /** Statespace path used for transform effects / before-transition constraints. */
  effectPath: Path<TState>;
  definitions: TDefs;
};
