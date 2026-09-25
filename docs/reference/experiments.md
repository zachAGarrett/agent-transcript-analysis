# Experiments reference

Experiments train `@khoralabs/tkn` lattices on fixture CSVs and analyze held-out decode paths.

## ExperimentDefinition

[`experiments/types.ts`](../../experiments/types.ts):

| Field | Role |
| --- | --- |
| `name` | CLI name / path segment |
| `version` | Version directory (`v1`) |
| `createProducer` | Build a `Producer` from CSV paths |
| `buildReport` | Analyze train hubs + held-out decode → report object |
| `printAnalysis` | Console summary after a run |
| `renderCharts` | `report.json` → self-contained HTML string |

## Shared runner

[`experiments/run-job.ts`](../../experiments/run-job.ts) `runJob`:

1. Create `experiments/<name>/<version>/runs/<jobId>/`.
2. Load all sequences from the producer; drop empty sequences.
3. Sort by id; 80/20 train/held-out (single sequence → train=heldOut).
4. Ingest train into SQLite `lattice.db`; `invalidateCompiled()`.
5. `buildReport` with hubs, held-out, and bound `decode`.
6. Write `report.json`; `printAnalysis`.

## Producers

| Producer | Module | Sequences |
| --- | --- | --- |
| `CsvProducer` | `csv-producer.ts` | One sequence per CSV (full session rows) |
| `AgentTurnProducer` | `agent-turn-producer.ts` | One sequence per agent turn; user intent in `meta.intent` |

`AgentTurnProducer` drops user rows from symbols; keeps preceding `intent:` in `meta`. Rows without `who` are skipped.

## Charts helpers

[`experiments/charts.ts`](../../experiments/charts.ts) exports primitives only (`labelPattern`, HTML builders, `resolveReportPath`, `writeAndOpenHtml`). Layout HTML lives in each experiment’s `charts.ts`.

## agent-turn (v1)

**Claim:** patterns should stay inside agent turns (no `who:user` in decoded patterns).

| Piece | Path |
| --- | --- |
| Definition | `experiments/agent-turn/v1/experiment.ts` |
| Analyze | `experiments/agent-turn/v1/analyze.ts` |
| Charts | `experiments/agent-turn/v1/charts.ts` |

Producer: `AgentTurnProducer`.

Report highlights (`AnalysisReport`):

| Field | Meaning |
| --- | --- |
| `viterbi` / `beam` | Decoder analyses |
| `patternsByHub` | Train graph hubs (macros length ≥ 2) |
| `patternsByFrequency` | Held-out decode frequency |
| `meanCompression` | mean(`symbols / tokens`) on held-out |
| `userAtomLeakShare` | Share of length≥2 patterns containing `who:user` (target ~0) |
| `intentToPatterns` | Co-occurrence of `meta.intent` × pattern on held-out |
| `comparison` | Jaccard of top frequency sets; divergent sequence count |

Charts: stats (including leak), frequency bars, hub table, intent → pattern table.

## session-span (v1)

**Claim:** patterns may span user and agent turns.

| Piece | Path |
| --- | --- |
| Definition | `experiments/session-span/v1/experiment.ts` |
| Analyze | `experiments/session-span/v1/analyze.ts` |
| Charts | `experiments/session-span/v1/charts.ts` |

Producer: `CsvProducer`.

Report highlights:

| Field | Meaning |
| --- | --- |
| `crossTurnShare` | Share of length≥2 patterns that include both `who:user` and `who:agent` |
| `patternsByHub` / `patternsByFrequency` | Same ranking idea as agent-turn; entries carry `crossesTurn` |
| `meanCompression` | Same |
| `comparison` | Same |

Charts: stats (including cross-turn share), frequency bars, hub table with Cross column (no intent table).

## Thin runners

`experiments/<name>/v1/run.ts` wraps `runJob` for a path or directory default. Prefer the CLI for sampling flags.
