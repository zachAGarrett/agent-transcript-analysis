# agent-turn

Train and decode lattice patterns on agent-turn sequences (one sequence per agent turn).

Splits full-session CSVs into agent-only turns via `AgentTurnProducer`, then measures
compression, hub patterns, intent→pattern pairs, and `userAtomLeak` (patterns that
incorrectly contain `who:user`).

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
bun cli experiments agent-turn -fv v1 -n 5
bun cli experiments agent-turn -fv v1 -fj 2026-09-25T15-27-27Z -n 50
bun cli experiments agent-turn charts
```

Thin wrapper (defaults to a fixture run directory):

```sh
bun experiments/agent-turn/v1/run.ts
bun experiments/agent-turn/v1/run.ts path/to/dir-or-file.csv
```

Outputs land under `experiments/agent-turn/v1/runs/<jobId>/` (`lattice.db`, `report.json`;
optional `report.html` from charts).

### Layout

| Path | Role |
| --- | --- |
| `v1/experiment.ts` | Experiment definition (`name`, producer, report, charts) |
| `v1/analyze.ts` | Held-out decode metrics and console summary |
| `v1/charts.ts` | HTML report via `renderCharts` |
| `v1/run.ts` | Direct runner (prefer CLI) |
| `v1/runs/` | Job artifacts (gitignored) |

More detail: [experiments reference](../../docs/reference/experiments.md),
[how to run](../../docs/how-to/run-experiments.md),
[how to chart](../../docs/how-to/chart-reports.md).

## Contributing

Open an issue or PR in the parent `workstream-tokens` repo. Keep changes scoped to this
experiment (or shared producers under `experiments/`). Run `bun test`, `bun run check`,
and `bun run typecheck` before sending a PR.

## License

UNLICENSED © workstream-tokens
