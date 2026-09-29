import type { CompositionCertificate } from "@workstream/morphism-space";
import { concatIR, type ExecutionIR, emptyIR, type IrOp, type MeasureKind } from "./execution-ir";
import { IrMeasure, IrOpKind, isTopKName, Morphism, Source, TopKBy, topKLimit } from "./ids";
import { SESSION_MORPHISMS } from "./morphisms/transitions";
import { composeCertifiedPath } from "./path-plan";
import type { PathStep } from "./types";

function loadMeasure(
  name: string,
): { measure: MeasureKind; source: Exclude<import("./ids").SourceKind, "none"> } | undefined {
  switch (name) {
    case Morphism.loadPatternMass:
      return { measure: IrMeasure.storedCount, source: Source.patternMass };
    case Morphism.loadPatternVocab:
      return { measure: IrMeasure.vocabulary, source: Source.patternVocab };
    case Morphism.loadEdgeWeight:
      return { measure: IrMeasure.edgeWeight, source: Source.edgeWeight };
    case Morphism.loadHub:
      return { measure: IrMeasure.hubScore, source: Source.patternHub };
    case Morphism.loadInDegree:
      return { measure: IrMeasure.inEdgeWeight, source: Source.inEdgeWeight };
    case Morphism.loadRunScalars:
      return { measure: IrMeasure.runScalars, source: Source.runScalars };
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
  if (load) return { ops: [{ op: IrOpKind.load, ...load }] };

  if (step.name === Morphism.rollupLength) return { ops: [{ op: IrOpKind.rollupLength }] };
  if (step.name === Morphism.rankByLength) return { ops: [{ op: IrOpKind.rankByLength }] };
  if (step.name === Morphism.normalize) return { ops: [{ op: IrOpKind.normalize }] };
  if (step.name === Morphism.facetRuns) return { ops: [{ op: IrOpKind.facet }] };
  if (step.name === Morphism.commit) return { ops: [{ op: IrOpKind.commit }] };
  if (step.name === Morphism.reRollup) return { ops: [{ op: IrOpKind.reRollup }] };

  if (isTopKName(step.name)) {
    return {
      ops: [
        { op: IrOpKind.topK, limit: topKLimit(step.name, step.params?.limit), by: TopKBy.value },
      ],
    };
  }

  if (step.name === Morphism.partitionByLength) {
    const limit = Number(step.params?.limit) || 10;
    return { ops: [{ op: IrOpKind.partitionByLength, limit }] };
  }

  if (step.name === Morphism.drillLengthPatterns) {
    const lengthKey = String(step.params?.lengthKey ?? "");
    const limit = Number(step.params?.limit) || 10;
    if (!lengthKey) throw new Error("drill_length_patterns requires lengthKey.");
    return { ops: [{ op: IrOpKind.filterLength, lengthKey, limit }] };
  }

  if (step.name === Morphism.focusRun) {
    const runId = String(step.params?.runId ?? "");
    return { ops: [{ op: IrOpKind.focusRun, runId }] };
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
    if (step.name === Morphism.rankByLength) ranked = true;
    if (isTopKName(step.name) && ranked) {
      fragment = {
        ops: [
          { op: IrOpKind.topK, limit: topKLimit(step.name, step.params?.limit), by: TopKBy.order },
        ],
      };
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
