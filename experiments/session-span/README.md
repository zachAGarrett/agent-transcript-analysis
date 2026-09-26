# session-span

Train lattice patterns on full-session sequences (spans may cross turns).

Uses `CsvProducer` over session CSVs. Claim: sequences may include both user and
agent rows; patterns that bridge `who:user` and `who:agent` are expected.

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
bun cli experiments session-span -fv v1 -fj 2026-09-25T15-27-27Z -p 20
```

Thin wrapper (defaults to a fixture run directory):

```sh
bun experiments/session-span/v1/run.ts
bun experiments/session-span/v1/run.ts path/to/dir-or-file.csv
```

Canonical artifact: `experiments/session-span/v1/runs/<jobId>/lattice.db`.

### Layout

| Path | Role |
| --- | --- |
| `v1/experiment.ts` | Experiment definition (`name`, `version`, `createProducer`) |
| `v1/run.ts` | Direct runner (prefer CLI) |
| `v1/runs/` | Job artifacts (gitignored) |

More detail: [experiments reference](../../docs/reference/experiments.md),
[how to run](../../docs/how-to/run-experiments.md).

## Contributing

Open an issue or PR in the parent `workstream-tokens` repo. Keep changes scoped to this
experiment (or shared producers under `experiments/`). Run `bun test`, `bun run check`,
and `bun run typecheck` before sending a PR.

## License

UNLICENSED © workstream-tokens
