import {
  type CompositionCertificate,
  classify,
  composeArrows,
  defineObjects,
  identityArrow,
  objectByKey,
  type SemanticObject,
} from "@very-coffee/statespace/morphisms";

export type { CompositionCertificate, SemanticObject };
export { classify, composeArrows, defineObjects, identityArrow, objectByKey };

/** Classify into at most one object; undefined when unclassified or ambiguous. */
export function objectOf<TState extends object>(
  state: TState,
  objects: readonly SemanticObject<TState>[],
): SemanticObject<TState> | undefined {
  const result = classify(state, objects);
  if (!result.ok) return undefined;
  return objectByKey(objects, result.value.object);
}

/** @deprecated Prefer SemanticObject from @very-coffee/statespace/morphisms */
export type SemanticObjectDef<TState extends object> = SemanticObject<TState>;
