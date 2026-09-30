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

**Discovered LZ segments** (training) ≠ **Viterbi-decoded patterns** (evaluation) ≠
**projected next-source-symbol targets** (prediction metrics).

Online and offline prediction share [`runtime/predictor.ts`](../../runtime/predictor.ts):

1. Candidate union from tip successors, atomic (latest-source) successors, decoded
   two-tip context successors, and a unigram pool of top vocabulary patterns.
2. Score with the compiled LM (`emissionLogProb` / `transitionLogProb`) plus add-k
   decoded trigrams and adaptive interpolation.
3. Rank patterns for the graph; project each pattern to its first terminal atom and
   aggregate duplicate symbols for evaluation.

### Prequential (test-then-train) order

Runtime events score the prior forecast against the arriving **source symbol**, then
learn / flush / decode / forecast:

`score → learn → flush → decode → update context → forecast next`

Uncovered trials count as misses; coverage is reported separately. Soft
`pattern.startsWith(actualSymbol)` matches are diagnostic only and do not affect
hit@k / MRR. Run reports include first-window and last-window metrics (window 32) and
deltas — the learning signal.

Frame `t` carries the outcome for the forecast made at `t−1`. The first frame has no
outcome; the final unobserved forecast stays unscored.

### Compression reduction

`compressionReduction = 1 − decodedStepCount / symbolCount` (0 = atomic/no reduction).
Supporting diagnostics: mean span (`symbolCount / decodedStepCount`), multi-symbol
coverage, and atomic fallback rate. Full `decodedStepCount` is persisted before the
events.jsonl steps tail is truncated.

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
- [`experiments/prefix.ts`](../../experiments/prefix.ts) — exact next-source-symbol hit@k / MRR after decoding held-out prefixes (shared LM predictor; soft prefix diagnostic separate).
- [`experiments/project.ts`](../../experiments/project.ts) — axis-mask projection ablations without a new fixture version.

## agent-turn / session-span (v1)

Unchanged claims: agent-turn keeps patterns inside turns; session-span may cross user/agent boundaries. Prefer CLI sampling + holdout flags over thin `run.ts` wrappers.
