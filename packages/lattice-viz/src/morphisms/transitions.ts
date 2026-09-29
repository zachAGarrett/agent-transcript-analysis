import { StateSpaceRepository } from "@statespace/core";
import { createMorphismSpace } from "@workstream/morphism-space";
import type { PathState } from "../path-state";
import { pathStateSchema } from "../path-state";
import type { PathStep } from "../types";
import { pathObjects } from "./objects";
import { morphismDefs } from "./registry";
import type { InterpretCtx, MorphismContract, MorphismCriteria } from "./types";

export const pathMorphismSpace = createMorphismSpace<
  PathState,
  InterpretCtx,
  PathStep,
  typeof morphismDefs
>({
  shape: pathStateSchema,
  effectPath: "tip",
  definitions: morphismDefs,
  objects: pathObjects,
});

export const pathSpace = pathMorphismSpace.stateSpace;

export const morphismByName = pathMorphismSpace.byName;
export const morphismCriteria: Record<string, MorphismCriteria> = pathMorphismSpace.criteria;
export const morphismContracts: Record<string, MorphismContract> = pathMorphismSpace.contracts;

/** Session morphisms update tip only — never appear in the construction plan. */
export const SESSION_MORPHISMS: Set<string> = pathMorphismSpace.sessionNames;

export function morphismLabel(name: string): string {
  return pathMorphismSpace.label(name as (typeof morphismDefs)[number]["name"]);
}

export function morphismWhat(name: string): string | undefined {
  return pathMorphismSpace.what(name as (typeof morphismDefs)[number]["name"]);
}

export function morphismReloads(name: string): boolean {
  return pathMorphismSpace.reloads(name as (typeof morphismDefs)[number]["name"]);
}

export function isUserFollowupChip(name: string): boolean {
  return pathMorphismSpace.isUserFollowup(name as (typeof morphismDefs)[number]["name"]);
}

export function enabledNames(state: PathState, context?: unknown): string[] {
  return pathMorphismSpace.enabledNames(state, context);
}

export function applyPath(
  state: PathState,
  name: string,
  context?: unknown,
): { ok: true; state: PathState } | { ok: false; error: string; state: PathState } {
  return pathMorphismSpace.apply(state, name, context);
}

let executable: ReturnType<typeof StateSpaceRepository.makeExecutable<PathState>> | undefined;

export function pathExecutable() {
  if (!executable) executable = StateSpaceRepository.makeExecutable(pathSpace);
  return executable;
}
