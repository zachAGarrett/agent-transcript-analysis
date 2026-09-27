# Composing run visualizations

Views are **paths of typed morphisms**, not a fixed menu of chart modes. A path space
(`@statespace/core`) exposes only contract-legal extensions via `enabled`; Jev (when
`AI_GATEWAY_API_KEY` is set) chooses among those names, and the rules fallback only
auto-applies when the next step is forced (unique legal move or `commit`). Render
**interprets** the path as SQL loads plus algebra (`merge` / `rollup` /
`topWithRemainder` / `normalize`).

## Objects and arrows

Summaries carry `(scope, grain, measure)`. Keyed bins form a monoid under `merge` when
contracts match. `rollup` is an additive pushforward (commutes with merge). `topWithRemainder`
and `normalize` are irreversible display boundaries.

Different runs are **facets**, never pooled counts.

## Contracts

Each morphism declares a **domain → codomain** (tip, grain, measure, flags). Guards in
the path space enforce that at runtime; `morphismContracts` is the catalog for docs and
review. Vocabulary grows by adding primitives under those contracts—not by special-case
SQL per chart.

| Kind | Domain | Codomain | Example |
| --- | --- | --- | --- |
| Load | `query` | `summary` + grain/measure | `load_pattern_mass` |
| Pushforward | `summary` + pattern, `!hasTopK` | `summary` + length | `rollup_length` |
| Order (summary) | `summary` + pattern, `!hasTopK` | same + `rankedByLength` | `rank_by_length` |
| Partition × display | `summary` + pattern mass/vocab, `!hasTopK` | displayed + `pattern-by-length` + `hasTopK` | `partition_by_length` |
| Display cut | summary / faceted | displayed / faceted + `hasTopK` | `top_k_*` |
| Reload | committed pattern top-k | committed length summary | `re_rollup` |

**Reload:** morphisms marked `reload` (`re_rollup`, `drill_length_patterns`,
`partition_by_length`) re-query full pattern bins and re-apply algebra. Do **not** sort or
merge residualized displayed bins (e.g. “sort by length after top-k”). That composition
stays illegal in `enabled`.

## Path space

Construction state starts at `query`. Morphisms include sources (`load_pattern_mass`, …),
`rollup_length`, `rank_by_length`, `partition_by_length`, `top_k_*`, `normalize`,
`facet_runs`, and `commit`. Follow-ups (`select_bin`, `open_pattern_detail`,
`focus_run`, `drill_length_patterns`, `re_rollup`) extend a committed/selected tip.
Illegal orders never appear in `enabled`.

Pattern labels are abbreviated transition chains (intent / purpose / tool); pattern detail
shows the abbreviated title, compacted code, and full tag metadata statically—no
encode/decode morphisms.
Preset named paths (overview, patterns, lengths, patterns-by-length, …) are macros for
docs and tests only. `patterns-by-length` is `load_pattern_mass → partition_by_length →
commit` (top patterns within each length), not a length histogram.

## Dependency

`vendor/statespace` is a git submodule (`coffee-fueled-dev/statespace`). Run
`bun run submodules:init` before `bun install` so `@statespace/core` resolves.

## Limits

Vocabulary grows with primitives × depth under contracts, with a practical step cap.
Stored `token_count` is overlapping mass, not message counts. Edge charts use stored
weights, not transition probabilities.
