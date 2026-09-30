# Composing run visualizations

Views are **typed morphism paths over a tip continuum**, not a fixed menu of chart modes.
Reusable bin algebra lives in [`packages/viz-algebra`](../../packages/viz-algebra/); the
declarative definition→statespace bridge and category kernel live in
[`packages/morphism-space`](../../packages/morphism-space/); the lattice exploration kernel
(path state, domain morphisms, interpret/IR, charts, session) lives in
[`packages/lattice-viz`](../../packages/lattice-viz/). Bun/SQLite I/O, fixture decoding, and
Jev path policy live in [`app/adapters`](../../app/adapters/); the React explorer holds a
canonical [`ExplorationSession`](../../packages/lattice-viz/src/session/exploration.ts).

A path space (`@very-coffee/statespace`, compiled via `@workstream/morphism-space`) exposes only
contract-legal extensions via `enabled`; Jev (when `AI_GATEWAY_API_KEY` is set) chooses
among those names, and the rules fallback only auto-applies when the next step is forced
(unique legal move or `commit`). React renders the current tip; the interpretation
functor turns the **compiled plan** into a backend-neutral execution IR, then SQLite
lowering or in-memory algebra (`merge` / `rollup` / `topWithRemainder` / `normalize`).

## Tip continuum vs construction plan

Constraints carve a continuum of tip states (`tip`, `grain`, `source`, selection,
`detailRequested`, `timelineRequested`, …). Effects update that tip (and sometimes the
construction plan). Exact path history is not the identity of the **semantic region**
(object).

- **Construction / display plan** (`state.steps`): loads, rollups, top-k, normalize,
  facet, commit, drill, re_rollup, focus_run — the **executable-plan subcategory** that
  interpret and `/api/view` consume.
- **Session tip effects** (no plan lineage): `select_bin`, `clear_selection`,
  `open_pattern_detail`, `close_pattern_detail`. These update selection / detail flags
  only; they are tip-category arrows, not data-plan interpretations. Pattern detail
  remains a dialog.
- **Runtime decode timeline** (exclusive tip lineage): `open_timeline_scrubber` is legal
  only from `tip === query` when `runHasEvents` (selected run has `events.jsonl`). It
  sets `tip === timeline` and replaces the chart panel with the decode scrubber +
  transition graph. Follow-ups swap that panel for rolling next-source-symbol accuracy,
  pattern length-by-step, or compression reduction (`show_timeline_accuracy` /
  `show_timeline_length` / `show_timeline_compression`); `show_timeline_graph` returns to
  the transition view. Accuracy uses persisted prequential outcomes (no frame lookahead)
  with rolling hit@1 / hit@8 / coverage and first→current learning deltas. Compression
  plots `1 − decodedStepCount / symbolCount` with mean-span and coverage diagnostics at
  the cursor. `close_timeline_scrubber` returns to `query`. Lattice follow-ups
  (`re_rollup`, length chips, …) stay disabled while `tip === timeline` — timeline is
  not a follow-up on hub/length mass charts.
- **Exploration session**: serializable `{ steps, catalogRuns, selectedRunId, display,
  selection, pathState }`. `compilePlan(session)` is the single boundary that turns
  display knobs into an executable `PathPlan`.

## Category model

**Sealing objects** are tip-level partitions (`tipObjects`: query, summary, displayed,
…). Registry morphisms declare `contract.source` / `target` (and optional `sources` /
`targets`) against those keys and are sealed with `instantiate`.

**Fine-grained regions** (`pathRegionKey` / `pathObjects`) remain for UI and grain-level
classification; they are not the composition endpoints.

**Arrows** are the sealed registry morphisms. Construction-plan certificates come from
`composeCertifiedPath`: replay with `enabled`/`apply`, witness the tip arrows taken, then
`composeArrows` (tip `source` / `target` / `intermediates`; logical step names). Identities
and flat associative composition live in `@very-coffee/statespace/morphisms`
(`identityArrow`, `composeArrows`, `instantiate`).

**Interpretation** is a functor from the executable-plan subcategory to execution IR
(`compilePath` / `compileStep`): `F(id) = ∅`, `F(g ∘ f) = F(g) ∘ F(f)` (IR concat).
`evaluateIR` is the reference denotation; SQLite lowering is an interchangeable backend
when `canLowerToSql` holds. Optimizer rewrites preserve denotation; they are not
additional morphisms.

Verified algebraic laws (example + property tests): merge monoid laws, rollup commuting
with merge, top-k mass conservation — see `packages/viz-algebra` and lattice
characterization / compile tests.

## Summaries and operators

Summaries carry `(scope, grain, measure)`. Keyed bins form a monoid under `merge` when
contracts match. `rollup` is an additive pushforward (commutes with merge). `topWithRemainder`
and `normalize` are irreversible display boundaries.

Different runs are **facets**, never pooled counts.

## Contracts and the morphism registry

Each lattice morphism is defined once in `packages/lattice-viz` (`morphisms/registry.ts`)
with phase (`construction` | `display` | `session`), criteria/copy, domain→codomain
strings (UI/docs), optional `source`/`target` object keys, `available.when` /
`available.otherwise`, tip effect, and optional legacy interpret handler.
`@workstream/morphism-space` compiles those definitions into a statespace plus
shared projections (`byName`, criteria, contracts, `enabledNames`, `apply`, session
names, `arrowOf`).

| Kind | Domain | Codomain | Example |
| --- | --- | --- | --- |
| Load | `query` | `summary` + grain/measure | `load_pattern_mass`, `load_pattern_vocab`, `load_edge_weight`, `load_hub`, `load_in_degree`, `load_decode_spans`, `load_decode_fallback` |
| Pushforward | `summary` + pattern, `!hasTopK` | `summary` + length | `rollup_length` (any pattern source) |
| Order (summary) | `summary` + pattern, `!hasTopK` | same + `rankedByLength` | `rank_by_length` |
| Partition × display | `summary` + pattern, `!hasTopK` | displayed + `pattern-by-length` + `hasTopK` | `partition_by_length` |
| Display cut | summary / faceted | displayed / faceted + `hasTopK` | `top_k_*` |
| Reload | committed pattern top-k | committed length summary | `re_rollup` |
| Session tip | committed/selected + context | selected / detail flags | `select_bin`, `open_pattern_detail` |
| Runtime timeline | `query` + `runHasEvents` | `timeline` (graph / accuracy / length / compression) | `open_timeline_scrubber`, `show_timeline_*`, `close_timeline_scrubber` |

**Reload:** morphisms marked `reload` (`re_rollup`, `drill_length_patterns`,
`partition_by_length`, `focus_run`) re-query full pattern bins and re-apply algebra. Do
**not** sort or merge residualized displayed bins (e.g. “sort by length after top-k”).
That composition stays illegal in `enabled`.

## Path space (`packages/lattice-viz`)

Construction starts at `query`. Morphisms include sources (`load_pattern_mass`,
`load_pattern_vocab`, `load_edge_weight`, `load_hub`, `load_in_degree`, `load_run_scalars`,
`load_decode_spans`, `load_decode_fallback`),
`rollup_length`, `rank_by_length`, `partition_by_length`, `top_k_*`, `normalize`,
`facet_runs`, and `commit`. Length construction applies to every pattern source (mass,
vocab, outgoing/incoming edge weight, hub score)—not only mass/vocab. After commit,
construction follow-ups (`focus_run`, `drill_length_patterns`, `re_rollup`) extend the plan;
session morphisms only move the tip. Illegal orders never appear in `enabled`.

Pattern labels are injected via `setPatternLabeler` (fixture-aware decoding in
`app/adapters/decode.ts`). The kernel itself does not import fixture schemes.

`hub_score` is written by `@khoralabs/tkn`’s `DegreeScorer` when a writable Lattice calls
`getTopTokens` (experiment `runJob` and `bun cli score <lattice.db>`). This repo does not
reimplement hub math. `load_hub` charts that column; `load_in_degree` / `load_edge_weight`
are SQL aggregates over `edges.weight`.

Preset named paths (overview, patterns, vocabulary, hubs, inflows, connectivity,
lengths, lengths-by-edge, lengths-by-hub, patterns-by-length, …) are macros in
`packages/lattice-viz` presets. The explorer shows starter chips for the common ones.
`patterns-by-length` is `load_pattern_mass → partition_by_length → commit` (top patterns
within each length), not a length histogram.

## Execution IR and SQL fusion

```text
PathPlan → compilePath → ExecutionIR → optimizeIR
                              ├─ canLowerToSql? → app/adapters/sqlite-plan.ts → SQLite
                              └─ else → evaluateIR (in-memory oracle)
```

Supported SQL fusions today: `load → top_k`, `load → rollup_length [→ top_k]`,
`load → re_rollup`. Rank-sensitive top-k, partition-by-length, and drill stay on the
memory backend until residual/order equivalence is proven. Decode-summary loads
(`load_decode_spans`, `load_decode_fallback`) read `decode-summary.json` sidecars and
never lower to SQLite. They are terminal for lattice drills (`drill_length_patterns`,
`partition_by_length`, `re_rollup`): decode bins are not lattice patterns. Length SQL uses
`MIN(32, LENGTH(token)-LENGTH(REPLACE(token,'|','')))`, matching `patternLengthKey`.

## Package layout

```text
packages/
  viz-algebra/          # Bin, Summary, merge/rollup/topWithRemainder/normalize
  morphism-space/       # defineMorphisms, category kernel, createMorphismSpace
  lattice-viz/          # PathState, objects, morphisms, IR, interpret, charts, session
app/
  adapters/             # RunStore, sqlite-plan, decode, Jev classify
  session/              # Explorer session helpers over ExplorationSession
  pages/, components/   # React UI
  server.ts             # Bun.serve API
```

Dependency direction:

`@very-coffee/statespace` → `@workstream/morphism-space` → `@workstream/lattice-viz` → `app`

(`viz-algebra` is a peer of `lattice-viz` for bin algebra only.)

Human-readable `domain`/`codomain` strings remain for UI/docs; executable tip legality
still uses `available.when`. Morphisms declare tip-level `source`/`target` (and optional
`sources`/`targets`) for `@very-coffee/statespace/morphisms` sealing. Plan certificates
are tip-level: `composeCertifiedPath` witnesses sealed arrows and calls `composeArrows`.
Fine-grained `pathRegionKey` / `pathObjects` stay for UI classification only.

## Dependency

Install `@very-coffee/statespace` from npm (`bun install`). Morphisms are imported from
`@very-coffee/statespace/morphisms`.

## Limits

Vocabulary grows with primitives under contracts. Stored `token_count` is overlapping
mass, not message counts. Edge charts use stored weights, not transition probabilities.
Hub charts use tkn `hub_score` (default `log1p` out-degree), not PageRank unless the
Lattice is constructed with `PageRankScorer`.
