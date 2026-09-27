# Explore experiment runs

Initialize the statespace submodule, then install and start the explorer:

```sh
bun run submodules:init
bun install
bun run visualize
```

Open <http://127.0.0.1:8766>. The server binds to loopback and reads
`experiments/agent-turn/v1/runs/*/lattice.db` through read-only SQLite.

1. **Ask** a question. With `AI_GATEWAY_API_KEY`, Jev walks the path space: only legal
   morphism extensions (`enabled`) are offered, then applied until `commit`. Without a
   key, Ask only finishes when every step is forced (unique legal move or `commit`) —
   there is no keyword rules composer.
2. Inspect the composed path (source → rollup / partition / top-k / normalize / facet →
   commit). `partition_by_length` shows top patterns within each length (not a length
   histogram — that is `rollup_length`).
3. Adjust display with compare / top-k / share-of-total when the tip allows them.
4. **Click a chart bin** to apply `select_bin`. Legal **follow-ups** update from `enabled`
   (`drill_length_patterns`, `focus_run`, `re_rollup`, `clear_selection`, …). Opening a
   pattern shows an abbreviated intent/purpose chain, compacted code, full tag metadata,
   and incoming/outgoing neighbors. That is how one chart becomes the next — same path
   space, no new mode.
5. **Refresh** after producing or changing runs.

```sh
EXPLORER_RUNS=/absolute/path/to/runs PORT=8767 bun run visualize
```

See [Composing run visualizations](../explanation/composable-visualizations.md).
