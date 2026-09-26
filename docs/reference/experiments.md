# Experiments reference

Experiments train `@khoralabs/tkn` lattices on fixture CSVs. The canonical run artifact is `lattice.db`.

## ExperimentDefinition

[`experiments/types.ts`](../../experiments/types.ts):

| Field | Role |
| --- | --- |
| `name` | CLI name / path segment |
| `version` | Version directory (`v1`) |
| `createProducer` | Build a `Producer` from CSV paths + fixture scheme version |

## Shared runner

[`experiments/run-job.ts`](../../experiments/run-job.ts) `runJob`:

1. Create `experiments/<name>/<version>/runs/<jobId>/`.
2. Load all sequences from the producer; drop empty sequences.
3. Ingest **all** sequences into SQLite `lattice.db`; `invalidateCompiled()`.
4. Log sequence count and lattice path; close the lattice.

Queries and charts (if needed later) should use the lattice SQLite / `@khoralabs/tkn` API directly.

## Producers

| Producer | Module | Sequences |
| --- | --- | --- |
| `CsvProducer` | `csv-producer.ts` | One sequence per CSV (full session rows) |
| `AgentTurnProducer` | `agent-turn-producer.ts` | One sequence per agent turn; user intent in `meta.intent` |

Producers take `fixtureVersion` (CLI `-fv`) and load that scheme’s encoder/decoder via [`fixtures/scheme.ts`](../../fixtures/scheme.ts). CSV headers must match the scheme taxonomy axes in order.

`AgentTurnProducer` drops user rows from symbols; keeps preceding `intent:` in `meta`. Rows without `who` are skipped.

## agent-turn (v1)

**Claim:** patterns should stay inside agent turns (no `who:user` in lattice symbols from the producer).

| Piece | Path |
| --- | --- |
| Definition | `experiments/agent-turn/v1/experiment.ts` |

Producer: `AgentTurnProducer`.

## session-span (v1)

**Claim:** sequences may include both user and agent rows (full session).

| Piece | Path |
| --- | --- |
| Definition | `experiments/session-span/v1/experiment.ts` |

Producer: `CsvProducer`.

## Thin runners

`experiments/<name>/v1/run.ts` wraps `runJob` for a path or directory default. Prefer the CLI for sampling flags.
