import type { ChartMeasure, ChartQuery } from "@/app/viz/chart-query";
import type { Bin } from "@/app/viz/types";

/** Pipe-count length capped at 32 — must match patternLengthKey in charts. */
export const LENGTH_SQL = `MIN(32, LENGTH(token) - LENGTH(REPLACE(token, '|', '')))`;

export type SqlitePlan = {
  sql: string;
  params: (string | number)[];
  kind: "patterns" | "lengths" | "filterLength";
  limit?: number;
  lengthKey?: string;
  measure: ChartMeasure;
  /** SUM of measure for the filtered length (filterLength only). */
  totalSql?: string;
  totalParams?: (string | number)[];
};

function valueExpr(measure: ChartMeasure): string {
  switch (measure) {
    case "hub":
      return "hub_score";
    case "outgoing":
      return "coalesce(e.value,0)";
    case "incoming":
      return "coalesce(e.value,0)";
    default:
      return "token_count";
  }
}

function fromClause(measure: ChartMeasure): string {
  if (measure === "outgoing") {
    return `nodes n LEFT JOIN (SELECT from_id, sum(weight) value FROM edges GROUP BY from_id) e ON e.from_id = n.id`;
  }
  if (measure === "incoming") {
    return `nodes n LEFT JOIN (SELECT to_id, sum(weight) value FROM edges GROUP BY to_id) e ON e.to_id = n.id`;
  }
  return "nodes";
}

function idTokenSelect(measure: ChartMeasure): string {
  if (measure === "outgoing" || measure === "incoming") {
    return "n.id AS id, n.token AS token";
  }
  return "id, token";
}

function lengthExpr(measure: ChartMeasure): string {
  if (measure === "outgoing" || measure === "incoming") {
    return `MIN(32, LENGTH(n.token) - LENGTH(REPLACE(n.token, '|', '')))`;
  }
  return LENGTH_SQL;
}

/** Parse lengthKey as a non-negative integer for SQLite params. */
export function parseLengthKey(raw: string | undefined): number {
  if (raw == null || raw === "") throw new Error("lengthKey is required.");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || !Number.isSafeInteger(n)) {
    throw new Error(`lengthKey must be a non-negative integer, got: ${JSON.stringify(raw)}`);
  }
  return n;
}

/** Build a parameterized SQLite plan for a chart query (non-overview). */
export function planForQuery(query: ChartQuery): SqlitePlan {
  const measure = query.measure;
  const value = valueExpr(measure);
  const from = fromClause(measure);
  const idTok = idTokenSelect(measure);
  const len = lengthExpr(measure);

  if (query.kind === "topPatterns") {
    return {
      sql: `SELECT ${idTok}, ${value} AS value FROM ${from} ORDER BY value DESC, id ASC LIMIT ?`,
      params: [query.limit],
      kind: "patterns",
      limit: query.limit,
      measure,
    };
  }

  if (query.kind === "byLength") {
    const inner = `SELECT ${len} AS len_key, SUM(${value}) AS value FROM ${from} GROUP BY 1`;
    return {
      sql: `SELECT len_key AS id, CAST(len_key AS TEXT) AS token, value FROM (${inner}) ORDER BY len_key ASC`,
      params: [],
      kind: "lengths",
      measure,
    };
  }

  if (query.kind === "lengthDrill") {
    const lengthKey = parseLengthKey(query.lengthKey);
    return {
      sql: `SELECT ${idTok}, ${value} AS value FROM ${from} WHERE ${len} = ? ORDER BY value DESC, id ASC LIMIT ?`,
      params: [lengthKey, query.limit],
      kind: "filterLength",
      limit: query.limit,
      lengthKey: query.lengthKey,
      measure,
      totalSql: `SELECT COALESCE(SUM(${value}), 0) AS total FROM ${from} WHERE ${len} = ?`,
      totalParams: [lengthKey],
    };
  }

  throw new Error(`No SQL plan for chart kind: ${query.kind}`);
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

export function totalForMeasure(
  measure: ChartMeasure,
  run: { mass: number; edgeWeight: number; hubScore: number },
): number {
  if (measure === "hub") return run.hubScore;
  if (measure === "outgoing" || measure === "incoming") return run.edgeWeight;
  return run.mass;
}

export function unitForMeasure(measure: ChartMeasure): string {
  if (measure === "hub") return "hub score";
  if (measure === "outgoing") return "outgoing edge weight";
  if (measure === "incoming") return "incoming edge weight";
  return "stored counts";
}
