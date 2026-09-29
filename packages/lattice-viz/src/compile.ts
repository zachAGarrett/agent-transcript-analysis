import type { CompositionCertificate } from "@workstream/morphism-space";
import { concatIR, type ExecutionIR, emptyIR, type IrOp, type MeasureKind } from "./execution-ir";
import { SESSION_MORPHISMS } from "./morphisms/transitions";
import { composeCertifiedPath } from "./path-plan";
import type { PathStep } from "./types";

function loadMeasure(name: string): { measure: MeasureKind; source: string } | undefined {
  switch (name) {
    case "load_pattern_mass":
      return { measure: "stored-count", source: "pattern-mass" };
    case "load_pattern_vocab":
      return { measure: "vocabulary", source: "pattern-vocab" };
    case "load_edge_weight":
      return { measure: "edge-weight", source: "edge-weight" };
    case "load_hub":
      return { measure: "hub-score", source: "pattern-hub" };
    case "load_in_degree":
      return { measure: "in-edge-weight", source: "in-edge-weight" };
    case "load_run_scalars":
      return { measure: "run-scalars", source: "run-scalars" };
    default:
      return undefined;
  }
}

/** Map one executable-plan step to an IR fragment. Session morphisms are rejected. */
export function compileStep(step: PathStep): ExecutionIR {
  if (SESSION_MORPHISMS.has(step.name)) {
    throw new Error(`Session morphism not in executable plan: ${step.name}`);
  }

  const load = loadMeasure(step.name);
  if (load) return { ops: [{ op: "load", ...load }] };

  if (step.name === "rollup_length") return { ops: [{ op: "rollupLength" }] };
  if (step.name === "rank_by_length") return { ops: [{ op: "rankByLength" }] };
  if (step.name === "normalize") return { ops: [{ op: "normalize" }] };
  if (step.name === "facet_runs") return { ops: [{ op: "facet" }] };
  if (step.name === "commit") return { ops: [{ op: "commit" }] };
  if (step.name === "re_rollup") return { ops: [{ op: "reRollup" }] };

  if (step.name.startsWith("top_k_")) {
    const limit = Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
    return { ops: [{ op: "topK", limit, by: "value" }] };
  }

  if (step.name === "partition_by_length") {
    const limit = Number(step.params?.limit) || 10;
    return { ops: [{ op: "partitionByLength", limit }] };
  }

  if (step.name === "drill_length_patterns") {
    const lengthKey = String(step.params?.lengthKey ?? "");
    const limit = Number(step.params?.limit) || 10;
    if (!lengthKey) throw new Error("drill_length_patterns requires lengthKey.");
    return { ops: [{ op: "filterLength", lengthKey, limit }] };
  }

  if (step.name === "focus_run") {
    const runId = String(step.params?.runId ?? "");
    return { ops: [{ op: "focusRun", runId }] };
  }

  throw new Error(`Unknown plan step: ${step.name}`);
}

/**
 * Interpretation functor on executable-plan paths:
 * F(id) = empty IR, F(g ∘ f) = F(g) ∘ F(f) (IR concatenation).
 * Returns the category certificate from path composition.
 */
export function compilePath(steps: PathStep[]): {
  ir: ExecutionIR;
  certificate: CompositionCertificate;
} {
  const { certificate } = composeCertifiedPath(steps);
  if (!certificate.ok) {
    return { ir: emptyIR(), certificate };
  }

  // Rank before top-k changes topK.by to order
  let ranked = false;
  let ir = emptyIR();
  for (const step of steps) {
    if (SESSION_MORPHISMS.has(step.name)) {
      return {
        ir: emptyIR(),
        certificate: {
          ok: false,
          intermediates: [],
          steps: [],
          error: `Session morphism not in executable plan: ${step.name}`,
        },
      };
    }
    let fragment = compileStep(step);
    if (step.name === "rank_by_length") ranked = true;
    if (step.name.startsWith("top_k_") && ranked) {
      const limit = Number(step.params?.limit ?? step.name.replace("top_k_", "")) || 10;
      fragment = { ops: [{ op: "topK", limit, by: "order" }] };
    }
    ir = concatIR(ir, fragment);
  }
  return { ir, certificate };
}

/** Identity arrow interprets to empty IR. */
export function compileIdentity(): ExecutionIR {
  return emptyIR();
}

export function irHasOp(ir: ExecutionIR, op: IrOp["op"]): boolean {
  return ir.ops.some((o) => o.op === op);
}
