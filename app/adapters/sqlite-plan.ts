import type { Bin, ExecutionIR, IrOp, MeasureKind } from "@workstream/lattice-viz";
import { IrMeasure, IrOpKind, TopKBy } from "@workstream/lattice-viz";

/** Pipe-count length capped at 32 — must match patternLengthKey. */
export const LENGTH_SQL = `MIN(32, LENGTH(token) - LENGTH(REPLACE(token, '|', '')))`;

export type SqlitePlan = {
  sql: string;
  params: (string | number)[];
  /** How to map rows into bins; residual assembled by caller using totals. */
  kind: "patterns" | "lengths" | "partition" | "filterLength";
  limit?: number;
  lengthKey?: string;
  measure: MeasureKind;
};

function valueExpr(measure: MeasureKind): string {
  switch (measure) {
    case IrMeasure.vocabulary:
      return "1";
    case IrMeasure.hubScore:
      return "hub_score";
    case IrMeasure.edgeWeight:
      return "coalesce(e.value,0)";
    case IrMeasure.inEdgeWeight:
      return "coalesce(e.value,0)";
    default:
      return "token_count";
  }
}

function fromClause(measure: MeasureKind): string {
  if (measure === IrMeasure.edgeWeight) {
    return `nodes n LEFT JOIN (SELECT from_id, sum(weight) value FROM edges GROUP BY from_id) e ON e.from_id = n.id`;
  }
  if (measure === IrMeasure.inEdgeWeight) {
    return `nodes n LEFT JOIN (SELECT to_id, sum(weight) value FROM edges GROUP BY to_id) e ON e.to_id = n.id`;
  }
  return "nodes";
}

function idTokenSelect(measure: MeasureKind): string {
  if (measure === IrMeasure.edgeWeight || measure === IrMeasure.inEdgeWeight) {
    return "n.id AS id, n.token AS token";
  }
  return "id, token";
}

function lengthExpr(measure: MeasureKind): string {
  if (measure === IrMeasure.edgeWeight || measure === IrMeasure.inEdgeWeight) {
    return `MIN(32, LENGTH(n.token) - LENGTH(REPLACE(n.token, '|', '')))`;
  }
  return LENGTH_SQL;
}

/**
 * Lower an optimized IR to a parameterized SQLite plan, or return null when
 * unsupported (caller falls back to in-memory evaluateIR).
 */
export function lowerToSqlite(ir: ExecutionIR): SqlitePlan | null {
  const ops = ir.ops.filter(
    (o) => o.op !== IrOpKind.commit && o.op !== IrOpKind.facet && o.op !== IrOpKind.normalize,
  );
  const load = ops[0];
  if (load?.op !== IrOpKind.load || load.measure === IrMeasure.runScalars) return null;

  const measure = load.measure;
  const value = valueExpr(measure);
  const from = fromClause(measure);
  const idTok = idTokenSelect(measure);
  const len = lengthExpr(measure);

  // load only or load → topK
  if (ops.length === 1 || (ops.length === 2 && ops[1]?.op === IrOpKind.topK)) {
    const topK = ops[1] as Extract<IrOp, { op: typeof IrOpKind.topK }> | undefined;
    if (topK?.by === TopKBy.order) return null;
    const limit = topK?.limit;
    const sql =
      limit != null
        ? `SELECT ${idTok}, ${value} AS value FROM ${from} ORDER BY value DESC, id ASC LIMIT ?`
        : `SELECT ${idTok}, ${value} AS value FROM ${from}`;
    return {
      sql,
      params: limit != null ? [limit] : [],
      kind: "patterns",
      limit,
      measure,
    };
  }

  // load → rollupLength [→ topK]
  if (ops[1]?.op === IrOpKind.rollupLength) {
    const topK = ops[2];
    if (topK && topK.op !== IrOpKind.topK) return null;
    if (topK?.op === IrOpKind.topK && topK.by === TopKBy.order) return null;
    const inner = `SELECT ${len} AS len_key, SUM(${value}) AS value FROM ${from} GROUP BY 1`;
    if (topK?.op === IrOpKind.topK) {
      return {
        sql: `SELECT len_key AS id, CAST(len_key AS TEXT) AS token, value FROM (${inner}) ORDER BY value DESC, len_key ASC LIMIT ?`,
        params: [topK.limit],
        kind: "lengths",
        limit: topK.limit,
        measure,
      };
    }
    return {
      sql: `SELECT len_key AS id, CAST(len_key AS TEXT) AS token, value FROM (${inner}) ORDER BY len_key ASC`,
      params: [],
      kind: "lengths",
      measure,
    };
  }

  // load → reRollup (same as rollup from full population)
  if (ops.length === 2 && ops[1]?.op === IrOpKind.reRollup) {
    const inner = `SELECT ${len} AS len_key, SUM(${value}) AS value FROM ${from} GROUP BY 1`;
    return {
      sql: `SELECT len_key AS id, CAST(len_key AS TEXT) AS token, value FROM (${inner}) ORDER BY len_key ASC`,
      params: [],
      kind: "lengths",
      measure,
    };
  }

  // load → filterLength
  if (ops.length === 2 && ops[1]?.op === IrOpKind.filterLength) {
    const filter = ops[1];
    return {
      sql: `SELECT ${idTok}, ${value} AS value FROM ${from} WHERE ${len} = ? ORDER BY value DESC, id ASC LIMIT ?`,
      params: [Number(filter.lengthKey), filter.limit],
      kind: "filterLength",
      limit: filter.limit,
      lengthKey: filter.lengthKey,
      measure,
    };
  }

  // load → partitionByLength via window functions
  if (ops.length === 2 && ops[1]?.op === IrOpKind.partitionByLength) {
    const part = ops[1];
    const base = `SELECT ${idTok}, ${value} AS value, ${len} AS len_key FROM ${from}`;
    const ranked = `SELECT *, ROW_NUMBER() OVER (PARTITION BY len_key ORDER BY value DESC, id ASC) AS rn FROM (${base})`;
    return {
      sql: `SELECT id, token, value, len_key FROM (${ranked}) WHERE rn <= ? ORDER BY len_key ASC, value DESC, id ASC`,
      params: [part.limit],
      kind: "partition",
      limit: part.limit,
      measure,
    };
  }

  return null;
}

export function rowsToBins(
  rows: { id: number; token: string; value: number; len_key?: number }[],
  kind: SqlitePlan["kind"],
  labeler: (bin: { id?: number; key: string; token?: string }) => string,
): Bin[] {
  if (kind === "lengths") {
    return rows.map((row) => ({
      key: String(row.id),
      label: String(row.id),
      value: row.value,
      id: Number(row.id),
      token: String(row.id),
    }));
  }
  if (kind === "partition") {
    return rows.map((row) => {
      const length = String(row.len_key ?? "");
      const lengthTag = length === "32" ? "32+" : length;
      return {
        key: `${length}:${row.id}`,
        label: `${lengthTag} · ${labeler({ id: row.id, key: String(row.id), token: row.token })}`,
        value: row.value,
        id: row.id,
        token: row.token,
      };
    });
  }
  if (kind === "filterLength") {
    return rows.map((row) => ({
      key: String(row.id),
      label: labeler({ id: row.id, key: String(row.id), token: row.token }),
      value: row.value,
      id: row.id,
      token: row.token,
    }));
  }
  return rows.map((row) => ({
    key: String(row.id),
    label: labeler({ id: row.id, key: String(row.id), token: row.token }),
    value: row.value,
    id: row.id,
    token: row.token,
  }));
}
