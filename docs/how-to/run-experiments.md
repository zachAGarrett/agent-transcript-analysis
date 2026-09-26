# How to run experiments

Train a lattice on fixture CSVs for `agent-turn` or `session-span` (v1).

## Prerequisites

A fixture job exists (see [prepare fixtures](prepare-fixtures.md)):

```sh
bun cli fixtures prepare -v v1 -a
```

## Smoke on a few CSVs

```sh
bun cli experiments agent-turn -fv v1 -n 5
bun cli experiments session-span -fv v1 -n 5
```

Uses the latest fixture job under `fixtures/<fv>/runs/` unless `-fj` is set.

## Pin a fixture job and sample

```sh
bun cli experiments agent-turn -fv v1 -fj 2026-09-25T15-27-27Z -n 50
bun cli experiments session-span -fv v1 -fj 2026-09-25T15-27-27Z -p 20
bun cli experiments agent-turn -fv v2 -fj 2026-09-25T22-55-36Z
```

## Read results

Canonical artifact:

```text
experiments/<name>/v1/runs/<jobId>/lattice.db
```

Console prints sequence count and the lattice path. Query the DB with `@khoralabs/tkn` / SQLite tooling as needed.

## Prefer CLI over run.ts

`experiments/<name>/v1/run.ts` is a thin wrapper without `-n` / `-p` / `-fj`. Use the CLI for sampling.
