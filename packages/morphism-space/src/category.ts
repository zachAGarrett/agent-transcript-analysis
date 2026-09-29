import type { ApplyResult } from "./types";

/** Runtime object of a state category — a named, checkable region. */
export type SemanticObjectDef<TState extends object> = {
  key: string;
  contains: (state: TState) => boolean;
};

/** Preserve literal object key unions from a const definition list. */
export function defineObjects<TState extends object>() {
  return <const TObjs extends readonly SemanticObjectDef<TState>[]>(objects: TObjs): TObjs =>
    objects;
}

/**
 * Classify a state into exactly one object. Returns undefined when unclassified
 * or ambiguous (multiple contains matches).
 */
export function objectOf<TState extends object>(
  state: TState,
  objects: readonly SemanticObjectDef<TState>[],
): SemanticObjectDef<TState> | undefined {
  let match: SemanticObjectDef<TState> | undefined;
  for (const object of objects) {
    if (!object.contains(state)) continue;
    if (match) return undefined;
    match = object;
  }
  return match;
}

export function objectByKey<TState extends object>(
  objects: readonly SemanticObjectDef<TState>[],
  key: string,
): SemanticObjectDef<TState> | undefined {
  return objects.find((object) => object.key === key);
}

/** Certificate for a composed (or single) arrow path. */
export type CompositionCertificate = {
  ok: boolean;
  source?: string;
  target?: string;
  intermediates: string[];
  steps: string[];
  error?: string;
};

/** Instantiated arrow with declared source/target object keys. */
export type CertifiedArrow<TState extends object, TContext = unknown> = {
  name: string;
  source: string;
  target: string;
  params?: Record<string, unknown>;
  apply: (state: TState, context?: TContext) => ApplyResult<TState>;
};

/** Generated identity endomorphism for an object. */
export function identityArrow<TState extends object, TContext = unknown>(
  objectKey: string,
): CertifiedArrow<TState, TContext> {
  return {
    name: `id_${objectKey}`,
    source: objectKey,
    target: objectKey,
    apply: (state) => ({ ok: true, state }),
  };
}

/**
 * Compose arrows left-to-right (f then g). Requires exact target/source match.
 * Composition is a flat step list so associativity is structural.
 */
export function composeArrows<TState extends object, TContext = unknown>(
  arrows: readonly CertifiedArrow<TState, TContext>[],
): { certificate: CompositionCertificate; apply: CertifiedArrow<TState, TContext>["apply"] } {
  if (arrows.length === 0) {
    return {
      certificate: { ok: false, intermediates: [], steps: [], error: "Empty composition." },
      apply: (state) => ({ ok: false, error: "Empty composition.", state }),
    };
  }

  for (let i = 0; i < arrows.length - 1; i++) {
    const left = arrows[i];
    const right = arrows[i + 1];
    if (!left || !right) continue;
    if (left.target !== right.source) {
      const error = `Cannot compose ${left.name} → ${right.name}: ${left.target} ≠ ${right.source}`;
      return {
        certificate: {
          ok: false,
          source: arrows[0]?.source,
          intermediates: [],
          steps: arrows.map((a) => a.name),
          error,
        },
        apply: (state) => ({ ok: false, error, state }),
      };
    }
  }

  const first = arrows[0];
  const last = arrows[arrows.length - 1];
  if (!first || !last) {
    return {
      certificate: { ok: false, intermediates: [], steps: [], error: "Empty composition." },
      apply: (state) => ({ ok: false, error: "Empty composition.", state }),
    };
  }

  const intermediates = arrows.slice(0, -1).map((a) => a.target);
  const certificate: CompositionCertificate = {
    ok: true,
    source: first.source,
    target: last.target,
    intermediates,
    steps: arrows.map((a) => a.name),
  };

  const apply: CertifiedArrow<TState, TContext>["apply"] = (state, context) => {
    let current = state;
    for (const arrow of arrows) {
      const result = arrow.apply(current, context);
      if (!result.ok) return result;
      current = result.state;
    }
    return { ok: true, state: current };
  };

  return { certificate, apply };
}

/**
 * Validate categorical membership then run effect; prove target closure.
 * Contextual guards (available.when) are checked separately by the caller or
 * embedded in `effect` via the statespace adapter.
 */
export function checkAndApply<TState extends object, TContext = unknown>(options: {
  state: TState;
  context?: TContext;
  sourceKey: string;
  targetKey: string;
  objects: readonly SemanticObjectDef<TState>[];
  effect: (state: TState, context?: TContext) => TState;
  /** Optional contextual/parameter guard before effect. */
  when?: (state: TState, context?: TContext) => boolean;
  otherwise?: string;
}): ApplyResult<TState> & { certificate: CompositionCertificate } {
  const { state, context, sourceKey, targetKey, objects, effect, when, otherwise } = options;
  const source = objectByKey(objects, sourceKey);
  if (!source) {
    const error = `Unknown source object: ${sourceKey}`;
    return {
      ok: false,
      error,
      state,
      certificate: { ok: false, intermediates: [], steps: [], error },
    };
  }
  const target = objectByKey(objects, targetKey);
  if (!target) {
    const error = `Unknown target object: ${targetKey}`;
    return {
      ok: false,
      error,
      state,
      certificate: { ok: false, intermediates: [], steps: [], error },
    };
  }

  const classified = objectOf(state, objects);
  if (!classified) {
    const error = "State is unclassified or ambiguous.";
    return {
      ok: false,
      error,
      state,
      certificate: { ok: false, intermediates: [], steps: [], error },
    };
  }
  if (classified.key !== sourceKey) {
    const error = `Expected region ${sourceKey}, got ${classified.key}`;
    return {
      ok: false,
      error,
      state,
      certificate: {
        ok: false,
        source: sourceKey,
        target: targetKey,
        intermediates: [],
        steps: [],
        error,
      },
    };
  }

  if (when && !when(state, context)) {
    const error = otherwise ?? "Not available in this context.";
    return {
      ok: false,
      error,
      state,
      certificate: {
        ok: false,
        source: sourceKey,
        target: targetKey,
        intermediates: [],
        steps: [],
        error,
      },
    };
  }

  try {
    const next = effect(state, context);
    const nextObject = objectOf(next, objects);
    if (!nextObject || nextObject.key !== targetKey) {
      const error = `Effect left region ${nextObject?.key ?? "unclassified"}; expected ${targetKey}`;
      return {
        ok: false,
        error,
        state,
        certificate: {
          ok: false,
          source: sourceKey,
          target: targetKey,
          intermediates: [],
          steps: [],
          error,
        },
      };
    }
    return {
      ok: true,
      state: next,
      certificate: {
        ok: true,
        source: sourceKey,
        target: targetKey,
        intermediates: [],
        steps: [],
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "transform failed";
    return {
      ok: false,
      error: message,
      state,
      certificate: {
        ok: false,
        source: sourceKey,
        target: targetKey,
        intermediates: [],
        steps: [],
        error: message,
      },
    };
  }
}
