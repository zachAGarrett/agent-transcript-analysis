import { Database } from "bun:sqlite";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type {
  Bin,
  Facet,
  PathPlan,
  PatternDetail,
  PatternLinks,
  PatternStep,
  Run,
  View,
} from "@workstream/lattice-viz";
import {
  canLowerToSql,
  compilePath,
  IrMeasure,
  interpretSummary,
  Morphism,
  optimizeIR,
  planIsOverview,
} from "@workstream/lattice-viz";
import { decodePatternSteps, patternDisplayLabel } from "./decode";
import { readDecodeSummary } from "./decode-traces";
import { lowerToSqlite, rowsToBins } from "./sqlite-plan";

export type { Facet, PatternDetail, PatternLinks, Run, View };

const summarySql = `SELECT count(*) nodes, coalesce(sum(token_count),0) mass,
  coalesce(sum(hub_score),0) hubScore, coalesce(sum(hub_score != 0),0) scored FROM nodes`;
const edgesSql = `SELECT count(*) edges, coalesce(sum(weight),0) edgeWeight,
  coalesce(max(weight),0) maxWeight FROM edges`;

const loadSql: Record<string, string> = {
  [Morphism.loadPatternMass]: "SELECT id, token, token_count value FROM nodes",
  [Morphism.loadPatternVocab]: "SELECT id, token, token_count value FROM nodes",
  [Morphism.loadHub]: "SELECT id, token, hub_score value FROM nodes",
  [Morphism.loadEdgeWeight]: `SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n
LEFT JOIN (SELECT from_id, sum(weight) value FROM edges GROUP BY from_id) e
ON e.from_id = n.id`,
  [Morphism.loadInDegree]: `SELECT n.id, n.token, coalesce(e.value,0) value FROM nodes n
LEFT JOIN (SELECT to_id, sum(weight) value FROM edges GROUP BY to_id) e
ON e.to_id = n.id`,
};

function loadStepSql(plan: PathPlan): string {
  const load = plan.steps.find((s) => s.name.startsWith("load_"));
  const sql = loadSql[load?.name ?? ""];
  return sql ?? "SELECT id, token, token_count value FROM nodes";
}

function totalForMeasure(measure: string, run: Run): number {
  if (measure === IrMeasure.vocabulary) return run.nodes;
  if (measure === IrMeasure.hubScore) return run.hubScore;
  if (measure === IrMeasure.edgeWeight || measure === IrMeasure.inEdgeWeight) return run.edgeWeight;
  return run.mass;
}

function unitForMeasure(measure: string): string {
  if (measure === IrMeasure.vocabulary) return "patterns";
  if (measure === IrMeasure.hubScore) return "hub score";
  if (measure === IrMeasure.edgeWeight) return "outgoing edge weight";
  if (measure === IrMeasure.inEdgeWeight) return "incoming edge weight";
  if (measure === IrMeasure.decodeSpan) return "decode steps";
  if (measure === IrMeasure.decodeFallback) return "rate";
  return "stored counts";
}

export class RunStore {
  readonly root: string;
  private cache = new Map<string, View>();
  constructor(root: string) {
    this.root = realpathSync(root);
  }

  private path(id: string): string {
    if (!/^[\w-]+$/.test(id)) throw new Error("Invalid run ID.");
    const directory = realpathSync(join(this.root, id));
    if (!directory.startsWith(`${this.root}${sep}`))
      throw new Error("Run escaped the configured root.");
    const path = realpathSync(join(directory, "lattice.db"));
    if (!path.startsWith(`${directory}${sep}`))
      throw new Error("Database escaped the run directory.");
    return path;
  }

  version(id: string): string {
    const path = this.path(id);
    return [
      path,
      `${path}-wal`,
      join(this.root, id, "report.json"),
      join(this.root, id, "decodes.jsonl"),
      join(this.root, id, "decode-summary.json"),
    ]
      .map((file) => {
        try {
          const s = statSync(file, { bigint: true });
          return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
        } catch {
          return "absent";
        }
      })
      .join("/");
  }

  /** No Lattice constructor, migrations, scorer writes, or checkpoints. WAL remains visible. */
  private read<T>(id: string, fn: (db: Database) => T): T {
    const db = new Database(this.path(id), { readonly: true });
    try {
      db.run("PRAGMA query_only = ON");
      return db.transaction(() => fn(db))();
    } finally {
      db.close();
    }
  }

  private async metadata(id: string) {
    const empty = { fixture: null, train: null, heldOut: null };
    const file = Bun.file(join(this.root, id, "report.json"));
    if (!(await file.exists()))
      return {
        ...empty,
        warning: "No report: training population and codebook provenance are unknown.",
      };
    try {
      if (file.size > 20_000_000) throw new Error("Report too large.");
      const { job } = await file.json();
      const hasDecodes = await Bun.file(join(this.root, id, "decodes.jsonl")).exists();
      const hasSummary = await Bun.file(join(this.root, id, "decode-summary.json")).exists();
      const warnings: string[] = [];
      if (job?.artifacts?.decodesJsonl && !hasDecodes) {
        warnings.push("report references decodes.jsonl but the file is missing.");
      }
      if (job?.artifacts?.decodeSummaryJson && !hasSummary) {
        warnings.push("report references decode-summary.json but the file is missing.");
      }
      return {
        fixture: typeof job?.producer?.dir === "string" ? job.producer.dir : null,
        train: typeof job?.trainCount === "number" ? job.trainCount : null,
        heldOut: typeof job?.heldOutCount === "number" ? job.heldOutCount : null,
        warning:
          warnings.length > 0
            ? warnings.join(" ")
            : "Report provides context; verify codebook version against fixture scheme.",
      };
    } catch {
      return { ...empty, warning: "Report could not be read; provenance is unknown." };
    }
  }

  async run(id: string): Promise<Run> {
    const meta = await this.metadata(id);
    return this.read(id, (db) => ({
      id,
      version: this.version(id),
      ...(db
        .query<{ nodes: number; mass: number; hubScore: number; scored: number }, []>(summarySql)
        .get() as {
        nodes: number;
        mass: number;
        hubScore: number;
        scored: number;
      }),
      ...(db
        .query<{ edges: number; edgeWeight: number; maxWeight: number }, []>(edgesSql)
        .get() as { edges: number; edgeWeight: number; maxWeight: number }),
      ...meta,
    }));
  }

  async catalog() {
    const runs: Run[] = [];
    const errors: { id: string; error: string }[] = [];
    const entries = readdirSync(this.root, { withFileTypes: true })
      .filter((entry: { isDirectory(): boolean; name: string }) => entry.isDirectory())
      .sort((a: { name: string }, b: { name: string }) => b.name.localeCompare(a.name));
    for (const entry of entries) {
      try {
        runs.push(await this.run(entry.name));
      } catch {
        errors.push({ id: entry.name, error: "Cannot read a compatible lattice.db." });
      }
    }
    return { runs, errors };
  }

  async view(plan: PathPlan): Promise<View> {
    // A single request is bounded. Changes during querying are retried; facets are never pooled.
    for (let attempt = 0; attempt < 3; attempt++) {
      const versions = plan.runs.map((id) => this.version(id));
      const key = JSON.stringify([plan, versions]);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, cacheHit: true };
      const facets: Facet[] = [];
      const isOverview = planIsOverview(plan);
      const { ir } = compilePath(plan.steps);
      const optimized = optimizeIR(ir);
      const loadOp = optimized.ops.find((o) => o.op === "load");
      const decodeLoad =
        loadOp &&
        "measure" in loadOp &&
        (loadOp.measure === IrMeasure.decodeSpan || loadOp.measure === IrMeasure.decodeFallback);
      const sqlitePlan =
        !isOverview && !decodeLoad && canLowerToSql(optimized) ? lowerToSqlite(optimized) : null;
      const fallbackSql = loadStepSql(plan);
      for (const id of plan.runs) {
        const run = await this.run(id);
        if (decodeLoad && loadOp && "measure" in loadOp) {
          const summary = await readDecodeSummary(this.root, id);
          if (!summary) {
            facets.push({
              run,
              bins: [],
              total: 0,
              unit: unitForMeasure(loadOp.measure),
              sql: "-- missing decode-summary.json",
            });
            continue;
          }
          let bins: Bin[];
          let total: number;
          if (loadOp.measure === IrMeasure.decodeSpan) {
            bins = summary.spanLengthBins.map((b) => ({
              key: b.key,
              label: b.label,
              value: b.value,
              token: b.key,
            }));
            total = bins.reduce((s, b) => s + b.value, 0);
          } else {
            const atomic = summary.fallbackRate;
            bins = [
              { key: "atomic", label: "Atomic fallback", value: atomic },
              { key: "multi", label: "Multi-symbol", value: Math.max(0, 1 - atomic) },
            ];
            total = 1;
          }
          const interpreted = interpretSummary(plan.steps, bins, {
            mass: total,
            nodes: bins.length,
            edgeWeight: total,
            hubScore: total,
          });
          facets.push({
            run,
            bins: interpreted.bins,
            total: interpreted.total,
            unit: interpreted.unit || unitForMeasure(loadOp.measure),
            sql: "-- decode-summary.json",
          });
          continue;
        }
        facets.push(
          this.read(id, (db) => {
            if (isOverview) {
              return {
                run,
                bins: [],
                total: 0,
                unit: "",
                sql: `${summarySql};\n${edgesSql};`,
              };
            }
            const totals = {
              mass: run.mass,
              nodes: run.nodes,
              edgeWeight: run.edgeWeight,
              hubScore: run.hubScore,
            };

            if (sqlitePlan) {
              const rows = db
                .query<
                  { id: number; token: string; value: number; len_key?: number },
                  (string | number)[]
                >(sqlitePlan.sql)
                .all(...sqlitePlan.params);
              let bins = rowsToBins(rows, sqlitePlan.kind, patternDisplayLabel);
              const total = totalForMeasure(sqlitePlan.measure, run);
              if (
                sqlitePlan.limit != null &&
                (sqlitePlan.kind === "patterns" || sqlitePlan.kind === "lengths")
              ) {
                const shown = bins.reduce((s, b) => s + b.value, 0);
                const remainder = total - shown;
                if (remainder > 1e-7) {
                  bins = [...bins, { key: "other", label: "All other patterns", value: remainder }];
                }
              }
              return {
                run,
                bins,
                total,
                unit: unitForMeasure(sqlitePlan.measure),
                sql: sqlitePlan.sql,
              };
            }

            const rows = db
              .query<{ id: number; token: string; value: number }, []>(fallbackSql)
              .all();
            const patternBins: Bin[] = rows.map((row) => ({
              key: String(row.id),
              label: patternDisplayLabel({
                id: row.id,
                key: String(row.id),
                token: row.token,
              }),
              value: row.value,
              id: row.id,
              token: row.token,
            }));
            const interpreted = interpretSummary(plan.steps, patternBins, totals);
            return {
              run,
              bins: interpreted.bins,
              total: interpreted.total,
              unit: interpreted.unit,
              sql: interpreted.sql,
            };
          }),
        );
      }
      if (versions.some((version, i) => version !== this.version(plan.runs[i] as string))) continue;
      const result = { plan, facets, generatedAt: new Date().toISOString(), cacheHit: false };
      if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, result);
      return result;
    }
    throw new Error("A run is being updated. Refresh when its write batch completes.");
  }

  detail(id: string, node: number, expectedVersion: string): PatternDetail {
    if (expectedVersion !== this.version(id))
      throw new Error("Run changed. Refresh this view before opening a pattern.");
    const detail = this.read(id, (db): PatternDetail => {
      const pattern = db
        .query<{ id: number; token: string; token_count: number; hub_score: number }, [number]>(
          "SELECT * FROM nodes WHERE id = ?",
        )
        .get(node);
      if (!pattern) throw new Error("Pattern not found.");
      const query = (outgoing: boolean): PatternLinks => {
        const source = outgoing ? "from_id" : "to_id";
        const target = outgoing ? "to_id" : "from_id";
        const rows = db
          .query<{ id: number; token: string; weight: number }, [number]>(
            `SELECT n.id,n.token,e.weight FROM edges e JOIN nodes n ON n.id=e.${target} WHERE e.${source}=? ORDER BY e.weight DESC,n.id LIMIT 12`,
          )
          .all(node);
        const total = db
          .query<{ total: number; count: number }, [number]>(
            `SELECT coalesce(sum(weight),0) total,count(*) count FROM edges WHERE ${source}=?`,
          )
          .get(node);
        const weightTotal = total?.total ?? 0;
        return {
          rows: rows.map((row) => ({
            ...row,
            prob: weightTotal > 0 ? row.weight / weightTotal : 0,
          })),
          ...total,
        };
      };
      let steps: PatternStep[] | null = null;
      try {
        steps = decodePatternSteps(pattern.token);
      } catch {
        /* Unknown codebooks remain raw; never guess a historical version. */
      }
      return { pattern, steps, outgoing: query(true), incoming: query(false) };
    });
    if (expectedVersion !== this.version(id))
      throw new Error("Run changed during query. Refresh this view.");
    return detail;
  }
}

export const defaultRoot = resolve(import.meta.dir, "../../experiments/agent-turn/v1/runs");
