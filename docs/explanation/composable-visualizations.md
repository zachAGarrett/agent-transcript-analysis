# Fixed category views

The explorer shows **three fixed multi-chart views**. Each chart loads via an explicit
`ChartQuery` and SQLite in [`app/adapters`](../../app/adapters/) — not a generative
morphism path. React renders Recharts models from [`app/viz`](../../app/viz/).

## Views

| View | Question | Charts |
| --- | --- | --- |
| **Lattice** | Where is the mass? | Run scalars, top patterns (All or by length), mass by length |
| **Connectivity** | How does the graph connect? | Top patterns (measure + length), weight by length (measure) |
| **Replay** | How did decode unfold? | Scrubber + transitions; timeline metrics (Accuracy / Length / Compression) |

Run picker is global. Replay requires `events.jsonl` on the selected run; Lattice and
Connectivity always use `lattice.db`.

View specs and query builders live in [`app/views.ts`](../../app/views.ts). Chart
types / helpers live in [`app/viz`](../../app/viz/).

## ChartQuery → SQL

```text
Explorer knobs → ChartQuery → /api/view → RunStore.query → SQLite → View → facetChartModels
```

`ChartQuery` kinds:

| kind | SQL shape |
| --- | --- |
| `overview` | Run scalars only (no bins) |
| `topPatterns` | Load measure → `ORDER BY value LIMIT ?` (+ residual) |
| `byLength` | Group by pipe-count length |
| `lengthDrill` | Filter one length → top-k (+ residual) |

Measures: `mass`, `hub`, `outgoing`, `incoming`. Display knobs (`limit`, `normalize`,
`faceted`) fold into the query when building it — not via session morphisms.

There is no Ask / Jev path composer or tip-exclusive timeline mode in the explorer.
Replay timeline charts are local UI state on `TimelineScrubber`.

## Package layout

```text
app/
  viz/                  # Bin, View, ChartQuery, chart models, labels
  views.ts              # Fixed Lattice / Connectivity / Replay specs
  adapters/             # RunStore, sqlite-plan, decode, runtime-timeline
  pages/, components/   # React UI
  server.ts             # Bun.serve API
```

No workspace packages for morphisms, statespace, or viz-algebra remain.

## Limits

Vocabulary grows with primitives under contracts. Stored `token_count` is overlapping
mass, not message counts. Edge charts use stored weights, not transition probabilities.
Hub charts use tkn `hub_score` (default `log1p` out-degree), not PageRank unless the
Lattice is constructed with `PageRankScorer`.
