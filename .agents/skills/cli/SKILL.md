---
name: cli
description: >-
  Operate the workstream-tokens Bun CLI: fixtures prepare and experiment runs.
  Use when the user asks to prepare CSVs, run agent-turn or session-span, or how
  to invoke `bun cli`.
---

# CLI (workstream-tokens)

Operator skill for the repo CLI (`bun cli` → [`cli/index.ts`](../../../cli/index.ts)).

**Do not invent flags.** Prefer the docs below; if they drift, fix docs via
[documentation](../agent-review/documentation/SKILL.md) (usually
[diataxis](../agent-review/documentation/diataxis/SKILL.md) under `docs/`, or
[readme](../agent-review/documentation/readme/SKILL.md) for README entrypoints).

## When to use

- Prepare fixture CSVs from Cursor transcripts (`v1` or `v2`)
- Run `agent-turn` / `session-span` (or ask which experiment)
- Explain CLI usage, job folders, or sampling (`-n` / `-p` / `-fj`)

## Quick commands

From the repo root (after `bun install`):

```sh
bun cli fixtures prepare -v v1 -a
bun cli fixtures prepare -v v1 -t <transcript-uuid>
bun cli fixtures prepare -v v2 -t <transcript-uuid>
bun cli fixtures prepare -v v2 -t <transcript-uuid> -c 12

bun cli experiments agent-turn -fv v1 -n 50
bun cli experiments session-span -fv v1 -fj <fixtureJobId> -p 20
```

`-n` and `-p` are mutually exclusive. Omit `-fj` → latest fixture job under that
version’s `runs/`. **v2** prepare needs `AI_GATEWAY_API_KEY`.

Each experiment run writes `experiments/<name>/<version>/runs/<jobId>/lattice.db`.

## Doc map (read these, do not duplicate)

| Need | Doc |
| --- | --- |
| Flag reference | [docs/reference/cli.md](../../../docs/reference/cli.md) |
| Paths / `runs/` conventions | [docs/reference/layout.md](../../../docs/reference/layout.md) |
| Fixture schemes (v1 / v2) | [docs/reference/fixtures.md](../../../docs/reference/fixtures.md) |
| Experiments | [docs/reference/experiments.md](../../../docs/reference/experiments.md) |
| Prepare CSVs | [docs/how-to/prepare-fixtures.md](../../../docs/how-to/prepare-fixtures.md) |
| Run experiments | [docs/how-to/run-experiments.md](../../../docs/how-to/run-experiments.md) |
| Why this pipeline | [docs/explanation/encoding-and-pipelines.md](../../../docs/explanation/encoding-and-pipelines.md) |
| Docs index | [docs/README.md](../../../docs/README.md) |

## Operator rules

1. Run CLI from the **repo root** with Bun.
2. Prefer CLI over `experiments/*/v1/run.ts` when sampling or pinning jobs.
3. Fixture/experiment `runs/` are gitignored — do not commit job artifacts.
4. When adding CLI flags or changing prepare/experiment behavior, update the matching **how-to + reference** pages (and READMEs if entrypoints change) using the [documentation](../agent-review/documentation/SKILL.md) skill.
