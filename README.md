# workstream-tokens

Tag Cursor agent transcripts and learn lattice patterns with `@khoralabs/tkn`.

Encode parent chats into versioned fixture CSVs, then run experiments (`agent-turn`,
`session-span`) that train a SQLite lattice (`lattice.db`).
See [docs/](docs/README.md) for how-tos, reference, and explanation.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Install

```sh
bun install
```

Requires [Bun](https://bun.com). Cursor parent transcripts are read from
`~/.cursor/projects/*/agent-transcripts/` when preparing fixtures.

## Usage

```sh
# Encode all parent transcripts (v1 scheme)
bun cli fixtures prepare -v v1 -a

# Train a lattice (sample first 50 CSVs from the latest fixture job)
bun cli experiments agent-turn -fv v1 -n 50
bun cli experiments session-span -fv v1 -n 50
```

CLI overview: [docs/reference/cli.md](docs/reference/cli.md).

## Documentation

| Kind | Pages |
| --- | --- |
| How-to | [Prepare fixtures](docs/how-to/prepare-fixtures.md), [Run experiments](docs/how-to/run-experiments.md) |
| Reference | [Layout](docs/reference/layout.md), [CLI](docs/reference/cli.md), [Fixtures v1](docs/reference/fixtures.md), [Experiments](docs/reference/experiments.md) |
| Explanation | [Encoding and pipelines](docs/explanation/encoding-and-pipelines.md) |

Per-experiment notes: [agent-turn](experiments/agent-turn/README.md), [session-span](experiments/session-span/README.md).

Agent skill for operating the CLI: [`.agents/skills/cli/SKILL.md`](.agents/skills/cli/SKILL.md).
Use [documentation](.agents/skills/agent-review/documentation/SKILL.md) when editing docs.

## Contributing

Open an issue or PR. Keep changes scoped. Before sending:

```sh
bun test
bun run check
bun run typecheck
```

Commit hooks run Biome, typecheck, and `@khoralabs/agent-review`.

## License

UNLICENSED © workstream-tokens
