import {
  ConstraintRepository,
  type StateSpace,
  StateSpaceRepository,
  type Transition,
} from "@statespace/core";
import type { PathState } from "../path-state";
import { pathStateSchema } from "../path-state";
import { morphismDefs } from "./registry";

function guard(
  fn: (state: PathState) => boolean,
  message: string,
): Transition<PathState>["constraints"][number] {
  return {
    path: "tip",
    phase: "before_transition",
    validation: ConstraintRepository.createImperative<PathState, "tip">((_v, state) => ({
      success: fn(state),
      message,
    })),
  };
}

function patch(
  name: string,
  update: (state: PathState, context?: unknown) => PathState,
  constraints: Transition<PathState>["constraints"],
): Transition<PathState> {
  return {
    name,
    constraints,
    effect: {
      path: "tip",
      operation: "transform",
      value: (_path, state, context) => {
        try {
          const next = update(state as PathState, context);
          return { success: true, state: next };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "transform failed",
          };
        }
      },
    },
  };
}

const transitions: Transition<PathState>[] = morphismDefs.map((def) =>
  patch(def.name, def.effect, [guard((s) => def.guard(s), def.guardMessage)]),
);

export const pathSpace: StateSpace<PathState> = {
  shape: pathStateSchema,
  transitions,
};

let executable: ReturnType<typeof StateSpaceRepository.makeExecutable<PathState>> | undefined;

export function pathExecutable() {
  if (!executable) executable = StateSpaceRepository.makeExecutable(pathSpace);
  return executable;
}

export function enabledNames(state: PathState, context?: unknown): string[] {
  return pathExecutable()
    .enabled(state, context)
    .map((t) => t.name);
}

export function applyPath(
  state: PathState,
  name: string,
  context?: unknown,
): { ok: true; state: PathState } | { ok: false; error: string; state: PathState } {
  const result = pathExecutable().apply(state, name, context);
  if (result.success) return { ok: true, state: result.state };
  return { ok: false, error: result.error ?? "apply failed", state: result.state };
}
