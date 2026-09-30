# Fixed category views

The explorer shows **three fixed multi-chart views**, not a generative morphism path.
Reusable bin algebra lives in [`packages/viz-algebra`](../../packages/viz-algebra/). Named
presets still compile to an executable plan → IR → SQLite or in-memory evaluation inside
[`packages/lattice-viz`](../../packages/lattice-viz/); the React app only picks a view and
display knobs (top-k / normalize).

## Views

| View | Question | Charts |
| --- | --- | --- |
| **Lattice** | Where is the mass? | Run scalars, top patterns (All or by length), mass by length |
| **Connectivity** | How does the graph connect? | Top patterns (measure + length), weight by length (measure) |
| **Replay** | How did decode unfold? | Scrubber + transitions; timeline metrics (Accuracy / Length / Compression) |

Run picker is global. Replay requires `events.jsonl` on the selected run; Lattice and
Connectivity always use `lattice.db`.

View specs and plan builders live in [`app/views.ts`](../../app/views.ts). Preset step
macros remain in [`packages/lattice-viz/src/presets.ts`](../../packages/lattice-viz/src/presets.ts).

## Tip continuum vs construction plan (backend only)

Under the hood, fixed charts still use path plans:

- **Construction / display plan** (`steps`): loads, rollups, top-k, normalize, facet,
  commit, partition — what `/api/view` consumes.
- **Display knobs**: limit / normalize are applied when building each chart’s
  plan (`buildChartPlan`), not by walking session morphisms in the UI.

There is no Ask / Jev path composer, follow-up chip strip, or tip-exclusive timeline mode
in the explorer.

## Summaries and operators

Summaries carry `(scope, grain, measure)`. Keyed bins form a monoid under `merge` when
contracts match. `rollup` is an additive pushforward (commutes with merge). `topWithRemainder`
and `normalize` are irreversible display boundaries.

Different runs are **facets**, never pooled counts.

## Execution IR and SQL fusion

```text
PathPlan → compilePath → ExecutionIR → optimizeIR
                              ├─ canLowerToSql? → app/adapters/sqlite-plan.ts → SQLite
                              └─ else → evaluateIR (in-memory oracle)
```

Supported SQL fusions today: `load → top_k`, `load → rollup_length [→ top_k]`,
`load → re_rollup`. Rank-sensitive top-k, partition-by-length, and drill stay on the
memory backend until residual/order equivalence is proven.

## Package layout

```text
packages/
  viz-algebra/          # Bin, Summary, merge/rollup/topWithRemainder/normalize
  morphism-space/       # defineMorphisms bridge (frozen; used by lattice-viz plans)
  lattice-viz/          # presets, IR, interpret, charts
app/
  views.ts              # Fixed Lattice / Connectivity / Replay specs
  adapters/             # RunStore, sqlite-plan, decode, runtime-timeline
  pages/, components/   # React UI
  server.ts             # Bun.serve API
```

Dependency direction:

`@very-coffee/statespace` → `@workstream/morphism-space` → `@workstream/lattice-viz` → `app`

(`viz-algebra` is a peer of `lattice-viz` for bin algebra only.)

## Limits

Vocabulary grows with primitives under contracts. Stored `token_count` is overlapping
mass, not message counts. Edge charts use stored weights, not transition probabilities.
Hub charts use tkn `hub_score` (default `log1p` out-degree), not PageRank unless the
Lattice is constructed with `PageRankScorer`. Offline `decode-summary.json` charts are
not part of the three explorer views.
