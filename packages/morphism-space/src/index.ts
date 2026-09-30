export { createMorphismSpace, logicalTransitionName } from "./create";
export type { CompositionCertificate, SemanticObject, SemanticObjectDef } from "./objects";
export {
  classify,
  composeArrows,
  defineObjects,
  identityArrow,
  objectByKey,
  objectOf,
} from "./objects";
export type {
  ApplyResult,
  CreateMorphismSpaceOptions,
  MorphismAvailability,
  MorphismContract,
  MorphismCriteria,
  MorphismDefinition,
  MorphismInterpret,
  MorphismPhase,
  MorphismSpace,
} from "./types";
export { defineMorphisms, Phase } from "./types";
