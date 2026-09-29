import type { ExecutionIR, IrOp } from "./execution-ir";

/**
 * Denotation-preserving rewrites. Never move rollup through top-k, and never
 * invent cross-run merges. Rank-sensitive top-k stays unfused for SQL backends.
 */
export function optimizeIR(ir: ExecutionIR): ExecutionIR {
  const ops = [...ir.ops];
  // Coalesce consecutive normalize / facet / commit no-ops at the end is fine;
  // drop duplicate normalize.
  const out: IrOp[] = [];
  let seenNormalize = false;
  for (const op of ops) {
    if (op.op === "normalize") {
      if (seenNormalize) continue;
      seenNormalize = true;
    }
    out.push(op);
  }
  return { ops: out };
}

/** True when the IR can be fully lowered to a single SQLite query. */
export function canLowerToSql(ir: ExecutionIR): boolean {
  const optimized = optimizeIR(ir);
  let hasRank = false;
  for (const op of optimized.ops) {
    if (op.op === "rankByLength") hasRank = true;
    if (op.op === "topK" && (op.by === "order" || hasRank)) return false;
    if (op.op === "focusRun") return false;
  }
  // Supported: load (+ optional rollupLength) (+ optional topK by value)
  // or load + partitionByLength or load + filterLength
  // or load + reRollup
  const kinds = optimized.ops.map((o) => o.op);
  if (kinds.includes("load") && kinds[0] !== "load") return false;
  if (kinds.filter((k) => k === "load").length !== 1) return false;
  const load = optimized.ops[0];
  if (load?.op !== "load") return false;
  if (load.measure === "run-scalars") return false;

  const dataOps = optimized.ops.filter(
    (o) => o.op !== "commit" && o.op !== "facet" && o.op !== "normalize",
  );
  // load only
  if (dataOps.length === 1) return true;
  // load → rollupLength [→ topK]
  if (dataOps[1]?.op === "rollupLength") {
    return dataOps.length === 2 || (dataOps.length === 3 && dataOps[2]?.op === "topK");
  }
  // load → topK
  if (dataOps[1]?.op === "topK" && dataOps.length === 2) return true;
  // load → reRollup (same denotation as rollup from full population)
  // partition/filterLength stay in-memory until residual SQL is proven.
  if (dataOps.length === 2 && dataOps[1]?.op === "reRollup") return true;
  return false;
}
