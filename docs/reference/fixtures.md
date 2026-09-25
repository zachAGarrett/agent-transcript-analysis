# Fixtures reference (v1)

Fixtures turn Cursor agent transcripts into versioned CSV encodings for experiments.

## Pipeline

```text
JSONL transcript
  → messagesFromTranscript (fixtures/v1/load.ts)
  → Pipeline + encoder (fixtures/pipeline.ts, fixtures/v1/encoder.ts)
  → CSV rows (fixtures/prepare.ts)
```

Entry: `prepareFixtures` in [`fixtures/prepare.ts`](../../fixtures/prepare.ts), invoked by `bun cli fixtures prepare`.

## v1 messages

Normalized shapes in [`fixtures/v1/message.ts`](../../fixtures/v1/message.ts):

| Kind | Source in JSONL | Notes |
| --- | --- | --- |
| `user` | `role: "user"` text | Query from `<user_query>` when present |
| `agent` | `role: "assistant"` content blocks | One message per `text` or `tool_use` block |
| `turn_ended` | `type: "turn_ended"` | Status string |

Session / composer metadata from `state.vscdb` is **not** encoded (not reliable per message).

## v1 taxonomy axes

Order is CSV column order ([`fixtures/v1/taxonomy.ts`](../../fixtures/v1/taxonomy.ts)):

| Axis | Applies to | Values (closed set / rules) |
| --- | --- | --- |
| `who` | all | `user`, `agent` |
| `intent` | user only | `plan`, `implement`, `fix`, `refactor`, `explain`, `review`, `test`, `other` (first regex match) |
| `kind` | agent only | `text`, `tool` |
| `tool` | agent tool only | Tool name or `other` |
| `sh` | Shell tool only | `git`, `bun`, `gh`, `other` (first argv token) |
| `end` | turn_ended only | status string (`success`, `error`, …) or `other` |

Axes that do not apply are empty CSV cells / `null` atoms / compact empty slot `-.`.

## Compact symbols

[`fixtures/encoders.ts`](../../fixtures/encoders.ts):

- Each atom maps to a base36 code ending in `.`.
- Empty axis: `EMPTY_SYMBOL` = `-.`.
- One message → one composite unit; units end with `UNIT_DELIMITER` = `|`.
- Multi-step lattice patterns concatenate units (`unit|unit|`).

Experiments rebuild composites from CSV columns via the v1 encoder’s `compact`.

## Prepare behavior

1. Resolve version (`-v` or latest `fixtures/v*`).
2. Select transcripts (`-t` or `-a` via `listParentTranscripts`).
3. Create `fixtures/<version>/runs/<jobId>/`.
4. For each transcript: feed messages through the encoder; skip all-null rows; write `<id>.csv` with taxonomy header.

## Key modules

| File | Export / role |
| --- | --- |
| `prepare.ts` | `prepareFixtures`, `listJobIds`, `fixtureRunsDir`, `latestFixtureVersion`, `RUNS_DIRNAME` |
| `v1/load.ts` | `listParentTranscripts`, `messagesFromTranscript` |
| `v1/encoder.ts` | `encoder` |
| `v1/decoder.ts` | `decoder` |
| `pipeline.ts` | `Pipeline` |
