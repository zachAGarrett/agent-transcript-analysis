import { Database } from "bun:sqlite";
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { ChartQuery } from "@/app/viz/chart-query";
import { patternDisplayLabel } from "@/app/viz/labels";
import type { Facet, PatternDetail, PatternLinks, PatternStep, Run, View } from "@/app/viz/types";
import { decodePatternSteps } from "./decode";
import { planForQuery, rowsToBins, totalForMeasure, unitForMeasure } from "./sqlite-plan";

export type { Facet, PatternDetail, PatternLinks, Run, View };

const summarySql = `SELECT count(*) nodes, coalesce(sum(token_count),0) mass,
  coalesce(sum(hub_score),0) hubScore, coalesce(sum(hub_score != 0),0) scored FROM nodes`;
const edgesSql = `SELECT count(*) edges, coalesce(sum(weight),0) edgeWeight,
  coalesce(max(weight),0) maxWeight FROM edges`;

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
      join(this.root, id, "events.jsonl"),
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
    const empty = { fixture: null, train: null, heldOut: null, hasEvents: false };
    const hasEvents = await Bun.file(join(this.root, id, "events.jsonl")).exists();
    const file = Bun.file(join(this.root, id, "report.json"));
    if (!(await file.exists()))
      return {
        ...empty,
        hasEvents,
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
      if (job?.artifacts?.eventsJsonl && !hasEvents) {
        warnings.push("report references events.jsonl but the file is missing.");
      }
      return {
        fixture: typeof job?.producer?.dir === "string" ? job.producer.dir : null,
        train: typeof job?.trainCount === "number" ? job.trainCount : null,
        heldOut: typeof job?.heldOutCount === "number" ? job.heldOutCount : null,
        hasEvents,
        warning:
          warnings.length > 0
            ? warnings.join(" ")
            : "Report provides context; verify codebook version against fixture scheme.",
      };
    } catch {
      return {
        ...empty,
        hasEvents,
        warning: "Report could not be read; provenance is unknown.",
      };
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

  async query(chartQuery: ChartQuery): Promise<View> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const versions = chartQuery.runs.map((id) => this.version(id));
      const key = JSON.stringify([chartQuery, versions]);
      const cached = this.cache.get(key);
      if (cached) return { ...cached, cacheHit: true };

      const facets: Facet[] = [];
      const isOverview = chartQuery.kind === "overview";
      const sqlitePlan = isOverview ? null : planForQuery(chartQuery);

      for (const id of chartQuery.runs) {
        const run = await this.run(id);
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
            if (!sqlitePlan) throw new Error("Missing SQL plan.");
            const rows = db
              .query<
                { id: number; token: string; value: number; len_key?: number },
                (string | number)[]
              >(sqlitePlan.sql)
              .all(...sqlitePlan.params);
            let bins = rowsToBins(rows, sqlitePlan.kind, patternDisplayLabel);
            let total = totalForMeasure(sqlitePlan.measure, run);
            if (
              sqlitePlan.kind === "filterLength" &&
              sqlitePlan.totalSql &&
              sqlitePlan.totalParams
            ) {
              const row = db
                .query<{ total: number }, (string | number)[]>(sqlitePlan.totalSql)
                .get(...sqlitePlan.totalParams);
              total = row?.total ?? 0;
            }
            if (
              sqlitePlan.limit != null &&
              (sqlitePlan.kind === "patterns" || sqlitePlan.kind === "filterLength")
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
          }),
        );
      }

      if (versions.some((version, i) => version !== this.version(chartQuery.runs[i] as string))) {
        continue;
      }
      const result: View = {
        query: chartQuery,
        facets,
        generatedAt: new Date().toISOString(),
        cacheHit: false,
      };
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

  /** Resolve a lattice node id from its composite token string. */
  patternIdByToken(id: string, token: string): number {
    if (!token) throw new Error("Missing pattern token.");
    return this.read(id, (db) => {
      const row = db
        .query<{ id: number }, [string]>("SELECT id FROM nodes WHERE token = ?")
        .get(token);
      if (!row) throw new Error("Pattern not found in this run’s lattice.");
      return row.id;
    });
  }
}

export const defaultRoot = resolve(import.meta.dir, "../../experiments/agent-turn/v1/runs");
