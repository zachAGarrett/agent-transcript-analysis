# Explore experiment runs

Install and start the explorer:

```sh
bun install
bun run visualize
```

Open <http://127.0.0.1:8766>. The server binds to loopback and reads
`experiments/agent-turn/v1/runs/*/lattice.db` through read-only SQLite (override with
`EXPLORER_RUNS`).

1. Pick a **view**: Lattice, Connectivity, or Replay.
2. Select a **run** in the sidebar (Refresh after new experiments).
3. On Lattice / Connectivity, adjust **Show** (top-k) and **Share of run total**.
   Each view loads several charts for that category in parallel.
4. Click a pattern bin (or a transition node on Replay) to open pattern detail.
5. **Replay** needs `events.jsonl` on the selected run — one scrubber advances
   transitions; pick Accuracy / Length / Compression on the metrics chart.

```sh
EXPLORER_RUNS=/absolute/path/to/runs PORT=8767 bun run visualize
```

See [Fixed category views](../explanation/composable-visualizations.md).
