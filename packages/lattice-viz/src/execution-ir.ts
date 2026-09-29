/**
 * Backend-neutral execution IR — the codomain of the interpretation functor
 * from executable-plan paths. Optimizer rewrites preserve denotation.
 */

export type MeasureKind =
  | "stored-count"
  | "vocabulary"
  | "edge-weight"
  | "hub-score"
  | "in-edge-weight"
  | "run-scalars";

export type IrOp =
  | { op: "load"; measure: MeasureKind; source: string }
  | { op: "rollupLength" }
  | { op: "rankByLength" }
  | { op: "topK"; limit: number; by: "value" | "order" }
  | { op: "partitionByLength"; limit: number }
  | { op: "filterLength"; lengthKey: string; limit: number }
  | { op: "normalize" }
  | { op: "facet" }
  | { op: "commit" }
  | { op: "reRollup" }
  | { op: "focusRun"; runId: string };

export type ExecutionIR = {
  ops: IrOp[];
};

export const emptyIR = (): ExecutionIR => ({ ops: [] });

export function concatIR(left: ExecutionIR, right: ExecutionIR): ExecutionIR {
  return { ops: [...left.ops, ...right.ops] };
}

export function irEquals(a: ExecutionIR, b: ExecutionIR): boolean {
  return JSON.stringify(a.ops) === JSON.stringify(b.ops);
}
