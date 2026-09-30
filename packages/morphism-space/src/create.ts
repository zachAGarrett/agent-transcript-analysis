import type { Schema } from "@very-coffee/statespace";
import {
  type Arrow,
  createMorphismSpace as createUpstreamMorphismSpace,
  err,
  instantiate,
  ok,
  type SemanticObject,
} from "@very-coffee/statespace/morphisms";
import type {
  ApplyResult,
  CreateMorphismSpaceOptions,
  MorphismDefinition,
  MorphismInterpret,
  MorphismPhase,
  MorphismSpace,
} from "./types";

const SOURCE_SEP = "@@";

/** Loose definition shape for compilation (context/interpret filled by domain packages). */
type AnyDef<TState extends object, TInterpretCtx = unknown, TStep = unknown> = MorphismDefinition<
  TState,
  // biome-ignore lint/suspicious/noExplicitAny: open context slot for domain-typed availability/effects
  any,
  TInterpretCtx,
  TStep,
  string
>;

function sourceKeys(def: { contract: { source: string; sources?: readonly string[] } }): string[] {
  return [...new Set([def.contract.source, ...(def.contract.sources ?? [])])];
}

function targetKeys(def: { contract: { target: string; targets?: readonly string[] } }): string[] {
  return [...new Set([def.contract.target, ...(def.contract.targets ?? [])])];
}

/**
 * Instance name for a sealed (source, target) pair.
 * - single pair → logical name
 * - multi-source, single target → `name@@source`
 * - multi-target → `name@@source@@target`
 */
function instanceName(
  logicalName: string,
  source: string,
  target: string,
  sources: readonly string[],
  targets: readonly string[],
): string {
  if (sources.length === 1 && targets.length === 1) return logicalName;
  if (targets.length === 1) return `${logicalName}${SOURCE_SEP}${source}`;
  return `${logicalName}${SOURCE_SEP}${source}${SOURCE_SEP}${target}`;
}

/** Strip `name@@…` expansion back to the domain definition name. */
export function logicalTransitionName(transitionName: string): string {
  const i = transitionName.indexOf(SOURCE_SEP);
  return i >= 0 ? transitionName.slice(0, i) : transitionName;
}

function domainRun<TState extends object, TInterpretCtx, TStep>(
  def: AnyDef<TState, TInterpretCtx, TStep>,
) {
  return (value: { state: TState }, context: unknown) => {
    if (!def.available.when(value.state, context)) {
      return err({ type: "unavailable" as const, reason: def.available.otherwise });
    }
    try {
      return ok(def.effect(value.state, context));
    } catch (cause) {
      return err({
        type: "effect-failed" as const,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
}

/** Seal one (source, target) pair via upstream `instantiate`. */
function toArrow<TState extends object, TInterpretCtx, TStep>(
  def: AnyDef<TState, TInterpretCtx, TStep>,
  source: string,
  target: string,
  objects: readonly SemanticObject<TState>[],
  name: string,
): Arrow<TState> {
  return instantiate(
    { name: def.name, source, target, run: domainRun(def) },
    undefined,
    objects,
    name,
  );
}

/**
 * Compile declarative domain morphism definitions into a statespace + metadata
 * registry via `@very-coffee/statespace/morphisms`.
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
>(
  options: CreateMorphismSpaceOptions<TState, unknown, TInterpretCtx, TStep, TDefs>,
): MorphismSpace<TState, unknown, TInterpretCtx, TStep, TDefs> {
  const { shape, definitions, objects } = options;
  const seen = new Set<string>();
  for (const def of definitions) {
    if (seen.has(def.name)) {
      throw new Error(`Duplicate morphism name: ${def.name}`);
    }
    seen.add(def.name);
    if (!def.contract.source || !def.contract.target) {
      throw new Error(`Morphism ${def.name} requires contract.source and contract.target.`);
    }
  }

  const objectKeys = new Set(objects.map((o) => o.key));
  if (objectKeys.size !== objects.length) {
    throw new Error("Duplicate semantic object key.");
  }

  const arrows: Arrow<TState>[] = [];
  const logicalToInstances = new Map<string, string[]>();
  /** logical → source → target → instance name */
  const instanceByEndpoints = new Map<string, Map<string, Map<string, string>>>();

  for (const def of definitions) {
    const sources = sourceKeys(def);
    const targets = targetKeys(def);
    const instances: string[] = [];
    const bySource = new Map<string, Map<string, string>>();
    for (const key of [...sources, ...targets]) {
      if (!objectKeys.has(key)) {
        throw new Error(`Unknown object for ${def.name}: ${key}`);
      }
    }
    for (const source of sources) {
      const byTarget = new Map<string, string>();
      for (const target of targets) {
        const name = instanceName(def.name, source, target, sources, targets);
        arrows.push(toArrow(def, source, target, objects, name));
        instances.push(name);
        byTarget.set(target, name);
      }
      bySource.set(source, byTarget);
    }
    logicalToInstances.set(def.name, instances);
    instanceByEndpoints.set(def.name, bySource);
  }

  const upstream = createUpstreamMorphismSpace({
    shape: shape as Schema<TState>,
    objects: objects as readonly SemanticObject<TState>[],
    morphisms: arrows,
  });
  const executable = upstream.makeExecutable();

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

  const sessionNames = new Set(
    definitions.filter((d) => d.phase === "session").map((d) => d.name),
  ) as Set<TDefs[number]["name"]>;

  const applyInstance = (
    state: TState,
    transitionName: string,
    context?: unknown,
  ): ApplyResult<TState> => {
    const result = executable.apply(state, transitionName, context);
    if (result.success) return { ok: true, state: result.state };
    return { ok: false, error: result.error ?? "apply failed", state: result.state };
  };

  const apply = (state: TState, name: string, context?: unknown): ApplyResult<TState> => {
    const instances = logicalToInstances.get(name);
    if (!instances?.length) {
      return { ok: false, error: `Unknown transition: ${name}`, state };
    }
    let last: ApplyResult<TState> = { ok: false, error: "apply failed", state };
    for (const instance of instances) {
      const result = applyInstance(state, instance, context);
      if (result.ok) return result;
      last = result;
    }
    return last;
  };

  const enabledNames = (state: TState, context?: unknown): TDefs[number]["name"][] => {
    const enabled = new Set<string>();
    for (const result of executable.enabled(state, context)) {
      enabled.add(logicalTransitionName(result.name));
    }
    return [...enabled] as TDefs[number]["name"][];
  };

  const arrowOf = (name: string): Arrow<TState> | undefined => {
    const instances = logicalToInstances.get(name);
    const primary = instances?.[0];
    return primary ? upstream.arrowOf(primary) : undefined;
  };

  const arrowInstance = (
    logicalName: string,
    source: string,
    target?: string,
  ): Arrow<TState> | undefined => {
    const bySource = instanceByEndpoints.get(logicalName);
    if (!bySource) return undefined;
    const byTarget = bySource.get(source);
    if (!byTarget) return undefined;
    if (target !== undefined) {
      const name = byTarget.get(target);
      return name ? upstream.arrowOf(name) : undefined;
    }
    // Prefer primary target when unambiguous; otherwise first sealed for this source.
    const primary = byName.get(logicalName as TDefs[number]["name"])?.contract.target;
    if (primary && byTarget.has(primary)) {
      const name = byTarget.get(primary);
      return name ? upstream.arrowOf(name) : undefined;
    }
    const first = byTarget.values().next().value;
    return first ? upstream.arrowOf(first) : undefined;
  };

  return {
    definitions,
    byName,
    stateSpace: upstream.stateSpace,
    criteria,
    contracts,
    objects,
    arrowOf,
    arrowInstance,
    namesByPhase: (phase: MorphismPhase) =>
      definitions.filter((d) => d.phase === phase).map((d) => d.name) as TDefs[number]["name"][],
    sessionNames,
    label: (name) => criteria[name]?.label ?? String(name),
    what: (name) => criteria[name]?.what,
    reloads: (name) => contracts[name]?.reload === true,
    isUserFollowup: (name) => contracts[name]?.userFollowup !== false,
    enabledNames,
    apply,
    interpretOf: (name) =>
      byName.get(name as TDefs[number]["name"])?.interpret as
        | MorphismInterpret<TInterpretCtx, TStep>
        | undefined,
  };
}
