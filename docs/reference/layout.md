# Layout and conventions

Reference for repository paths used by the CLI, fixtures, and experiments.

## Top-level

| Path | Role |
| --- | --- |
| `cli/index.ts` | Repo CLI (`bun cli` / package `bin.cli`) |
| `fixtures/` | Versioned tagging schemes + prepare pipeline |
| `experiments/` | Shared experiment runtime + named experiments |
| `docs/` | Diátaxis docs (how-to, reference, explanation) |

## Fixtures

```text
fixtures/
  prepare.ts              # prepareFixtures, listJobIds, RUNS_DIRNAME
  pipeline.ts             # Pipeline over an Encoder
  encoders.ts             # Atom, Encoding, UNIT_DELIMITER, EMPTY_SYMBOL
  taxonomies.ts           # TaxonomyEntry helpers
  v1/                     # current scheme version
    message.ts
    taxonomy.ts
    encoder.ts
    decoder.ts
    load.ts               # listParentTranscripts, messagesFromTranscript
    run.ts                # thin prepare wrapper
    encoder.test.ts
    runs/                 # gitignored job outputs
      <jobId>/
        <transcriptId>.csv
```

### Version directories

- Name: `v*` (example: `v1`).
- Latest version for CLI defaults: lexicographic last `fixtures/v*` directory.
- A version is a self-contained scheme: taxonomy axes, codebook, message shapes, transcript loader.

### Job directories

- Path: `fixtures/<version>/runs/<jobId>/`.
- `jobId`: UTC ISO timestamp with `:` / `.` replaced by `-` (example: `2026-09-25T15-27-27Z`).
- One CSV per parent transcript: `<transcriptId>.csv`.
- Jobs under `runs/` are gitignored.

### CSV shape (v1)

Header row is taxonomy axis names in order:

```text
who,intent,kind,tool,sh,end
```

Each following row is one encoded message. Empty cells are axes that do not apply (`null` atoms). Values are axis values only (no `axis:` prefix).

## Experiments

```text
experiments/
  types.ts                # ExperimentDefinition, BuildReportContext
  run-job.ts              # shared train / decode / report runner
  pipeline.ts             # ExperimentPipeline over @khoralabs/tkn Lattice
  producers.ts            # Sequence, Producer
  csv-producer.ts         # full-session sequences from CSVs
  agent-turn-producer.ts  # agent-turn projection
  charts.ts               # shared HTML chart primitives + report IO
  agent-turn/
    README.md
    v1/
      experiment.ts
      analyze.ts
      charts.ts
      run.ts
      runs/               # gitignored
        <jobId>/
          lattice.db
          report.json
          report.html     # optional, from charts CLI
  session-span/
    README.md
    v1/
      …                   # same layout as agent-turn/v1
```

### Naming

| Segment | Meaning |
| --- | --- |
| `experiments/<name>/` | Experiment product (example: `agent-turn`) |
| `experiments/<name>/<version>/` | Experiment runner version (`v1`) |
| `…/runs/<jobId>/` | One train/decode job |

CLI discovery: a directory under `experiments/<name>/` is a version if it contains `experiment.ts` and is not named `runs` and does not look like a datetime job id.

### Shared vs per-experiment

| Module | Shared | Per experiment |
| --- | --- | --- |
| Train/decode loop | `run-job.ts` | — |
| Producer | `csv-producer.ts`, `agent-turn-producer.ts` | chosen in `experiment.ts` |
| Report metrics | — | `analyze.ts` |
| HTML charts | primitives in `charts.ts` | `renderCharts` in `<version>/charts.ts` |

## Transcript sources (fixtures prepare)

Parent Cursor chats (not subagents):

```text
~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl
```

Skipped: paths containing `/subagents/`, and JSONL files whose basename is not `<id>.jsonl`.
