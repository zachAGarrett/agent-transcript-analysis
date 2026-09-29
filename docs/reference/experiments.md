# Experiments reference

Experiments train `@khoralabs/tkn` lattices on fixture CSVs and optionally decode held-out sequences.

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
3. Optionally split by **session id** (`--holdout`, `--seed`) so turns from one transcript cannot leak across train/holdout.
4. Ingest **train** sequences into SQLite `lattice.db` with `endSequence()` boundaries.
5. Score hubs via tkn `getTopTokens`.
6. When holdout is set: compile once, `scanAtoms` + `decodeIndexed` each hold-out sequence, write `decodes.jsonl` + `decode-summary.json`.
7. Write versioned `report.json` (provenance, split ids, artifact paths, metrics).

### Artifacts

| File | Role |
| --- | --- |
| `lattice.db` | Learned patterns and transitions |
| `report.json` | Provenance + split + metrics |
| `decodes.jsonl` | Per-sequence scored `DecodeResult` traces (spans, emission/transition scores) |
| `decode-summary.json` | Frozen aggregate bins for explorer IR loads |

### Decoder objective

Native decoding maximizes the sum of token emission and adjacent transition log probabilities (add-k smoothed). Primitive and composite emissions share one count space, so longer segmentations may be favored; report both score and span/compression metrics.

**Discovered LZ segments** (training) ≠ **Viterbi-decoded patterns** (evaluation) ≠ **predicted next patterns** (`getNext` after a decoded prefix).

## Pipeline

[`experiments/pipeline.ts`](../../experiments/pipeline.ts):

- Ingest: shared dictionary, `endSequence()` + cleared transition cursor per sequence.
- Decode: `compile({ smoothing? })` → `scanAtoms(symbols)` → `decodeIndexed` → `DecodeResult`.

## Producers

| Producer | Module | Sequences |
| --- | --- | --- |
| `CsvProducer` | `csv-producer.ts` | One sequence per CSV (full session rows) |
| `AgentTurnProducer` | `agent-turn-producer.ts` | One sequence per agent turn; user intent in `meta.intent` |

## CLI

```text
bun cli experiments <name> [-fv] [-fj] [-n|-p] [--holdout <pct>] [--seed <n>] [--beam <w>] [--unigram]
bun cli experiments sweep [-e <name>] [--kind decoder|lm] [--holdout] [--seed] [-n]
```

## Sweeps and prefix prediction

- [`experiments/sweeps.ts`](../../experiments/sweeps.ts) — decoder beam widths and LM (bigram/unigram + smoothing) hold-out comparisons; MDL components are reported separately (encoding cost vs vocabulary cost).
- [`experiments/prefix.ts`](../../experiments/prefix.ts) — hit@k / MRR over `getNext(lastDecodedToken)` after decoding prefixes.
- [`experiments/project.ts`](../../experiments/project.ts) — axis-mask projection ablations without a new fixture version.

## agent-turn / session-span (v1)

Unchanged claims: agent-turn keeps patterns inside turns; session-span may cross user/agent boundaries. Prefer CLI sampling + holdout flags over thin `run.ts` wrappers.
