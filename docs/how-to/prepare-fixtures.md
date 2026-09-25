# How to prepare fixture CSVs

Encode local Cursor parent transcripts with the v1 tagging scheme.

## Prerequisites

- Bun installed
- Dependencies: `bun install` from the repo root
- Transcripts under `~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl`

## Encode everything

```sh
bun cli fixtures prepare -v v1 -a
```

Writes `fixtures/v1/runs/<jobId>/*.csv` and prints the job path.

## Encode one transcript

```sh
bun cli fixtures prepare -v v1 -t <transcript-uuid>
```

## Check the output

```sh
head -n 5 fixtures/v1/runs/<jobId>/<transcript-uuid>.csv
```

Header should be `who,intent,kind,tool,sh,end`. Re-run prepare after taxonomy or loader changes; old jobs stay on disk until you delete them.

## Next

- [How to run experiments](run-experiments.md)
- [Fixtures reference](../reference/fixtures.md)
