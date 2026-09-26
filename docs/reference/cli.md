# CLI reference

Binary: [`cli/index.ts`](../../cli/index.ts). Invoke with `bun cli` or the package `bin` name `cli`.

Flags are positional and hand-parsed. Unknown trailing args print usage and exit `1`.

## `fixtures prepare`

Encode Cursor parent transcripts into CSVs under `fixtures/<version>/runs/<jobId>/`.

```text
cli fixtures prepare [-v <version>] (-t <transcriptId> | -a) [-c <concurrency>]
```

| Flag | Meaning |
| --- | --- |
| `-v <version>` | Fixture scheme version (directory under `fixtures/`). Omit → latest `v*`. |
| `-t <transcriptId>` | Encode one parent transcript UUID. |
| `-a` | Encode every discovered parent transcript. |
| `-c <concurrency>` | Max concurrent encode calls per transcript (default 8). Useful for v2 Jev. |

Exactly one of `-t` / `-a` is required.

Examples:

```sh
bun cli fixtures prepare -v v1 -a
bun cli fixtures prepare -v v2 -t 3478de7b-79b9-458d-9028-1db767ff17fc -c 12
bun cli fixtures prepare -t 0a146418-e845-4d84-be97-25f32ac5610c
```

**v2** requires `AI_GATEWAY_API_KEY` (Jev Choice for `intent` / `purpose`).

## `experiments <name>`

Train a lattice (`lattice.db`) for a named experiment.

```text
cli experiments <name> [-v <version>] [-fv <fixtureVersion>] [-fj <jobId>]
                       [-g <glob>] [-n <count> | -p <pct>]
```

| Flag | Meaning |
| --- | --- |
| `-v <version>` | Experiment version (`experiment.ts` under `experiments/<name>/`). Omit → latest. |
| `-fv <fixtureVersion>` | Fixture scheme whose `runs/` supply CSVs. Omit → latest fixture version. |
| `-fj <jobId>` | Fixture job folder under `fixtures/<fv>/runs/`. Omit → latest job. |
| `-g <glob>` | CSV glob inside the fixture job (default `*.csv`). |
| `-n <count>` | Take the first `count` CSV names (sorted). |
| `-p <pct>` | Take the first `floor(matched * pct / 100)` CSVs (at least 1). |

`-n` and `-p` are mutually exclusive. Sample is applied after the glob.

Known experiment names are directories that contain at least one version directory with `experiment.ts` (currently `agent-turn`, `session-span`).

Examples:

```sh
bun cli experiments agent-turn -fv v1 -n 5
bun cli experiments session-span -fv v1 -fj 2026-09-25T15-27-27Z -p 20
bun cli experiments agent-turn -v v1 -fv v2 -fj 2026-09-25T22-55-36Z
```

Output: `experiments/<name>/<version>/runs/<jobId>/lattice.db`.
