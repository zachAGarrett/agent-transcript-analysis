# Fixtures reference

Fixtures turn Cursor agent transcripts into versioned CSV encodings for experiments.

## Pipeline

```text
JSONL transcript
  → messagesFromTranscript (fixtures/<version>/load.ts)
  → Pipeline + encoder (fixtures/pipeline.ts, fixtures/<version>/encoder.ts)
  → CSV rows (fixtures/prepare.ts)
```

Entry: `prepareFixtures` in [`fixtures/prepare.ts`](../../fixtures/prepare.ts), invoked by `bun cli fixtures prepare`.

Session / composer metadata from `state.vscdb` is **not** encoded (not reliable per message).

## Compact symbols

[`fixtures/encoders.ts`](../../fixtures/encoders.ts):

- Each atom maps to a base36 code ending in `.`.
- Empty axis: `EMPTY_SYMBOL` = `-.`.
- One message → one composite unit; units end with `UNIT_DELIMITER` = `|`.
- Multi-step lattice patterns concatenate units (`unit|unit|`).

Experiments rebuild composites from CSV columns via the version encoder’s `compact`.

## Prepare behavior

1. Resolve version (`-v` or latest `fixtures/v*`).
2. Select transcripts (`-t` or `-a` via `listParentTranscripts`).
3. Create `fixtures/<version>/runs/<jobId>/`.
4. For each transcript: feed messages through the encoder; skip all-null rows; write `<id>.csv` with taxonomy header.

---

## v1

### Messages

Normalized shapes in [`fixtures/v1/message.ts`](../../fixtures/v1/message.ts):

| Kind | Source in JSONL | Notes |
| --- | --- | --- |
| `user` | `role: "user"` text | Query from `<user_query>` when present |
| `agent` | `role: "assistant"` content blocks | One message per `text` or `tool_use` block |
| `turn_ended` | `type: "turn_ended"` | Status string |

### Taxonomy axes

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

### Modules

| File | Export / role |
| --- | --- |
| `v1/load.ts` | `listParentTranscripts`, `messagesFromTranscript` |
| `v1/encoder.ts` | `encoder` |
| `v1/decoder.ts` | `decoder` |

---

## v2

v2 keeps structural axes deterministic and classifies **`intent`** / **`purpose`** with [Jev Choice](https://docs.typesafe.ai/primitives/choice.md) via Vercel AI Gateway (`typesafe-ai/jev`).

Requires `AI_GATEWAY_API_KEY` in the environment (Bun loads `.env`).

### Messages

[`fixtures/v2/message.ts`](../../fixtures/v2/message.ts) adds payload for Choice state:

| Field | When | Notes |
| --- | --- | --- |
| `agentText` | agent text | Full text block |
| `toolInputSummary` | agent tool | Compact non-secret arg sketch |
| `shellCommand` | Shell tool | Same as v1 |

### Taxonomy axes

CSV header: `who,intent,purpose,kind,tool,sh,end`

| Axis | Source | Applies to | Values |
| --- | --- | --- |
| `who` | deterministic | all | `user`, `agent` |
| `intent` | Jev Choice | user | `plan`, `implement`, `fix`, `refactor`, `explain`, `review`, `test`, `other` |
| `purpose` | Jev Choice | agent | `explore`, `edit`, `verify`, `plan`, `ask`, `narrate`, `other` |
| `kind` | deterministic | agent | `text`, `tool` |
| `tool` | deterministic | agent tool | Tool name or `other` |
| `sh` | deterministic | Shell | `git`, `bun`, `gh`, `other` |
| `end` | deterministic | turn_ended | status or `other` |

Choice criteria use structured `what` / `not_for` / `examples` ([Advanced: structure](https://docs.typesafe.ai/primitives/advanced)).

### Modules

| File | Role |
| --- | --- |
| `v2/load.ts` | Loader + `summarizeToolInput` |
| `v2/labels.ts` | Closed sets + Choice criteria |
| `v2/jev.ts` | AI Gateway systemone client (argmax Choice labels) |
| `v2/taxonomy.ts` | Axes (Jev for intent/purpose) |

## Shared modules

| File | Export / role |
| --- | --- |
| `prepare.ts` | `prepareFixtures`, `listJobIds`, `fixtureRunsDir`, `latestFixtureVersion`, `RUNS_DIRNAME` |
| `pipeline.ts` | `Pipeline` |
| `encoders.ts` | Compact encoding helpers |
| `taxonomies.ts` | `TaxonomyEntry` |
