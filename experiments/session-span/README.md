# session-span

Train and decode lattice patterns on full-session sequences (spans may cross turns).

Uses `CsvProducer` over session CSVs, then measures compression, hub patterns, and
`crossTurnShare` (patterns that bridge `who:user` and `who:agent`).

## Install

From the repo root:

```sh
bun install
```

Prepare fixtures before running (if needed):

```sh
bun cli fixtures prepare -v v1 -a
```

## Usage

Preferred entry — CLI from the repo root:

```sh
bun cli experiments session-span -fv v1 -n 5
bun cli experiments session-span -fv v1 -fj 2026-09-24T23-33-14Z -p 20
bun cli experiments session-span -v v1 -fv v1 -n 5
```

Thin wrapper (defaults to a fixture run directory):

```sh
bun experiments/session-span/v1/run.ts
bun experiments/session-span/v1/run.ts path/to/dir-or-file.csv
```

Outputs land under `experiments/session-span/v1/runs/<jobId>/` (`lattice.db`, `report.json`).

### Layout

| Path | Role |
| --- | --- |
| `v1/experiment.ts` | Experiment definition (`name`, producer, report) |
| `v1/analyze.ts` | Held-out decode metrics and console summary |
| `v1/run.ts` | Direct runner (prefer CLI) |
| `v1/runs/` | Job artifacts |

## Contributing

Open an issue or PR in the parent `workstream-tokens` repo. Keep changes scoped to this
experiment (or shared producers under `experiments/`). Run `bun test`, `bun run check`,
and `bun run typecheck` before sending a PR.

## License

UNLICENSED © workstream-tokens
