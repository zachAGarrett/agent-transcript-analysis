# Encoding and experiment pipelines

Why fixtures and experiments are split, and what each stage optimizes for.

## Two stages

1. **Fixtures** — map transcripts into a closed tag vocabulary (CSV). No lattice learning.
2. **Experiments** — learn reusable multi-step patterns (`@khoralabs/tkn`) on those tags into a SQLite `lattice.db`.

Keeping stages separate means taxonomy changes re-prepare CSVs; experiment logic can change without re-reading JSONL.

## Why tags, not text

Lattice keys are compacted composites of taxonomy atoms. Raw prose is not in the feed. That keeps patterns about structure (tool sequences, turn boundaries) rather than chat wording.

## Why only transcript-local axes (v1)

Composer settings (`model`, `mode`, …) live in Cursor’s `state.vscdb` as mutable session metadata. They share the composer id with the transcript folder but are not a per-turn log. Encoding them as a session header made experiments look like they conditioned on model/mode when they did not. v1 therefore encodes only JSONL-derivable fields: speaker, intent heuristics, tool shape, turn end.

## One assistant line, many rows

Assistant JSONL messages often mix `text` and `tool_use` in one `content` array. The loader emits **one agent message per block**, so explore→act rhythms stay visible as adjacent composites instead of a single fused row.

## Two experiment projections

| Experiment | Sequence unit | Question |
| --- | --- | --- |
| **agent-turn** | Agent steps after one user message | What macros does the agent use inside a turn? |
| **session-span** | Full CSV session | Do macros cross the user/agent boundary? |

Same CSVs, different producers. Agent-turn stashes user intent in `meta` so it can correlate later without putting `who:user` into the lattice symbols.

## Canonical artifact

Each experiment run writes `lattice.db` under `experiments/<name>/<version>/runs/<jobId>/`. That SQLite lattice is the source of truth for hubs, decode, and any future queries or charts — not a separate report schema.
