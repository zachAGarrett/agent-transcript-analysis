# Replay a transcript through the online runtime

Feed one historical Cursor parent transcript through the online learn + live decode
loop and review the result.

## Prerequisites

```sh
bun install
```

No fixture prepare step — replay reads
`~/.cursor/projects/*/agent-transcripts/<id>/<id>.jsonl` directly.

## Replay

```sh
bun cli runtime replay -v v1 -t <transcript-uuid>
```

Optional: `-c <concurrency>` (default 8), `--recompile-every <n>` (default 1),
`--commit-batch <n>` (default 10; how often segments flush into the lattice).

Output:

```text
runtime/<version>/runs/<jobId>/
  lattice.db      # learned session-span lattice (hub-scored)
  events.jsonl    # tagged | decoded | sessionEnded stream
  report.json     # provenance
```

Inspect the live timeline:

```sh
jq -c 'select(.kind=="decoded") | {index, symbol, symbolCount, multiSymbolCoverage}' \
  runtime/v1/runs/<jobId>/events.jsonl
```

Decoded rows are compact (metrics + a steps tail) so long sessions stay readable.
## Explore the lattice

```sh
EXPLORER_RUNS=$PWD/runtime/v1/runs bun run visualize
```

Open <http://127.0.0.1:8766> and refresh after new replays.

When the selected run has `events.jsonl`, Ask “timeline” / “scrub” (or the **Timeline**
followup from the query tip) opens a **runtime-decode lineage** — not a lattice-chart
follow-up. The default view is the transition graph with a shared scrubber. Follow-ups
**Accuracy** and **Pattern length** replace the graph with step charts (scrubber stays);
**Transitions** returns to the graph. Breadcrumb is Timeline → Accuracy|Length; lattice
crumbs return after **Close timeline**.

See [Explore experiment runs](explore-runs.md) for explorer usage (same UI; different
`EXPLORER_RUNS` root).

Runtime timeline is entered from query for runs with events, then graph/accuracy/length
stay inside that tip — see [Composable visualizations](../explanation/composable-visualizations.md).
