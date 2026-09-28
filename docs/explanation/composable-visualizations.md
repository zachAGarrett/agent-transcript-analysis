# Composing run visualizations

Views are **typed morphism paths over a tip continuum**, not a fixed menu of chart modes.
Reusable bin algebra lives in [`packages/viz-algebra`](../../packages/viz-algebra/); the
lattice exploration kernel (path space, interpret, charts, session) lives in
[`packages/lattice-viz`](../../packages/lattice-viz/). Bun/SQLite I/O, fixture decoding, and
Jev path policy live in [`app/adapters`](../../app/adapters/); the React explorer holds a
canonical [`ExplorationSession`](../../packages/lattice-viz/src/session/exploration.ts).

A path space (`@statespace/core`) exposes only contract-legal extensions via `enabled`;
Jev (when `AI_GATEWAY_API_KEY` is set) chooses among those names, and the rules fallback
only auto-applies when the next step is forced (unique legal move or `commit`). React
renders the current tip; interpret turns the **compiled plan** into SQL + algebra
(`merge` / `rollup` / `topWithRemainder` / `normalize`).

## Tip continuum vs construction plan

Constraints carve a continuum of tip states (`tip`, `grain`, `source`, selection,
`detailRequested`, …). Effects update that tip (and sometimes the construction plan).
Exact path history is not the identity of the state.

- **Construction / display plan** (`state.steps`): loads, rollups, top-k, normalize,
  facet, commit, drill, re_rollup, focus_run — what interpret and `/api/view` consume.
- **Session tip effects** (no plan lineage): `select_bin`, `clear_selection`,
  `open_pattern_detail`, `close_pattern_detail`. These update selection / detail flags
  only; Focus/Unfocus pattern is a cycle on the tip.
- **Exploration session**: serializable `{ steps, catalogRuns, selectedRunId, display,
  selection, pathState }`. `compilePlan(session)` is the single boundary that turns
  display knobs into an executable `PathPlan` (replacing ad-hoc plan surgery).

## Objects and arrows

Summaries carry `(scope, grain, measure)`. Keyed bins form a monoid under `merge` when
contracts match. `rollup` is an additive pushforward (commutes with merge). `topWithRemainder`
and `normalize` are irreversible display boundaries.

Different runs are **facets**, never pooled counts.

## Contracts and the morphism registry

Each morphism is defined once in `packages/lattice-viz` (`morphisms/registry.ts`) with
phase (`construction` | `display` | `session`), criteria/copy, domain→codomain contract,
guard, tip effect, and optional interpret handler. Transitions, Jev criteria, reload flags,
and bin interpretation are derived from that registry — not duplicated switches.

| Kind | Domain | Codomain | Example |
| --- | --- | --- | --- |
| Load | `query` | `summary` + grain/measure | `load_pattern_mass` |
| Pushforward | `summary` + pattern, `!hasTopK` | `summary` + length | `rollup_length` |
| Order (summary) | `summary` + pattern, `!hasTopK` | same + `rankedByLength` | `rank_by_length` |
| Partition × display | `summary` + pattern mass/vocab, `!hasTopK` | displayed + `pattern-by-length` + `hasTopK` | `partition_by_length` |
| Display cut | summary / faceted | displayed / faceted + `hasTopK` | `top_k_*` |
| Reload | committed pattern top-k | committed length summary | `re_rollup` |
| Session tip | committed/selected + context | selected / detail flags | `select_bin`, `open_pattern_detail` |

**Reload:** morphisms marked `reload` (`re_rollup`, `drill_length_patterns`,
`partition_by_length`, `focus_run`) re-query full pattern bins and re-apply algebra. Do
**not** sort or merge residualized displayed bins (e.g. “sort by length after top-k”).
That composition stays illegal in `enabled`.

## Path space (`packages/lattice-viz`)

Construction starts at `query`. Morphisms include sources (`load_pattern_mass`, …),
`rollup_length`, `rank_by_length`, `partition_by_length`, `top_k_*`, `normalize`,
`facet_runs`, and `commit`. After commit, construction follow-ups (`focus_run`,
`drill_length_patterns`, `re_rollup`) extend the plan; session morphisms only move the tip.
Illegal orders never appear in `enabled`.

Pattern labels are injected via `setPatternLabeler` (fixture-aware decoding in
`app/adapters/decode.ts`). The kernel itself does not import fixture schemes.

Preset named paths (overview, patterns, lengths, patterns-by-length, …) are macros in
`packages/lattice-viz` presets for docs and tests only. `patterns-by-length` is
`load_pattern_mass → partition_by_length → commit` (top patterns within each length), not a
length histogram.

## Package layout

```text
packages/
  viz-algebra/          # Bin, Summary, merge/rollup/topWithRemainder/normalize
  lattice-viz/          # PathState, morphisms, interpret, charts, ExplorationSession
app/
  adapters/             # RunStore (Bun SQLite), decode, Jev classify
  session/              # Explorer session helpers over ExplorationSession
  pages/, components/   # React UI
  server.ts             # Bun.serve API
```

Dependency direction: `viz-algebra` ← `lattice-viz` ← `app/adapters` ← `app` (server/UI).
`@statespace/core` is a peer of `lattice-viz` only.

## Dependency

`vendor/statespace` is a git submodule (`coffee-fueled-dev/statespace`). Run
`bun run submodules:init` before `bun install` so `@statespace/core` resolves.

## Limits

Vocabulary grows with primitives under contracts. Stored `token_count` is overlapping
mass, not message counts. Edge charts use stored weights, not transition probabilities.
