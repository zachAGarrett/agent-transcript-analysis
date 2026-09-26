# How to prepare fixture CSVs

Encode local Cursor parent transcripts with a versioned tagging scheme (`v1` or `v2`).

## Prerequisites

- Bun installed
- Dependencies: `bun install` from the repo root
- Transcripts under `~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl`
- For **v2**: `AI_GATEWAY_API_KEY` in `.env` (Jev via Vercel AI Gateway)

## Encode everything (v1)

```sh
bun cli fixtures prepare -v v1 -a
```

Writes `fixtures/v1/runs/<jobId>/*.csv` and prints the job path.

## Encode one transcript

```sh
bun cli fixtures prepare -v v1 -t <transcript-uuid>
bun cli fixtures prepare -v v2 -t <transcript-uuid>
bun cli fixtures prepare -v v2 -t <transcript-uuid> -c 12
```

v2 calls Jev once per user/agent row for `intent` / `purpose` (structural axes stay local). Prefer `-t` over `-a` until you are ready for the API cost/latency. `-c` caps concurrent encode/Jev calls (default 8); rows are written in transcript order after each batch completes.

## Check the output

```sh
head -n 5 fixtures/v1/runs/<jobId>/<transcript-uuid>.csv
head -n 5 fixtures/v2/runs/<jobId>/<transcript-uuid>.csv
```

v1 header: `who,intent,kind,tool,sh,end`.  
v2 header: `who,intent,purpose,kind,tool,sh,end`.

Re-run prepare after taxonomy or loader changes; old jobs stay on disk until you delete them.

## Next

- [How to run experiments](run-experiments.md)
- [Fixtures reference](../reference/fixtures.md)
