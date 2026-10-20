# workstream-tokens

Learn lattice patterns over symbol streams with `@khoralabs/tkn`, packaged as
`@workstream/host` contracts/kernels, a Bun WebSocket host in `apps/service`, and
the lattice explorer in `apps/explorer`. See [docs/](docs/README.md).

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

Requires [Bun](https://bun.com).

## Usage

```sh
# Start the WebSocket host
bun run service

# Management CLI (one session; prefer `run` for multi-step)
bun run service:cli -- list

# Explorer over runtime/v1/runs (override with EXPLORER_RUNS)
bun run visualize
```

## Documentation

| Kind | Pages |
| --- | --- |
| How-to | [Run service](docs/how-to/run-service.md), [Explore runs](docs/how-to/explore-runs.md) |
| Reference | [Layout](docs/reference/layout.md), [Host](docs/reference/host.md) |

Agent skill for the service CLI: [`.agents/skills/cli/SKILL.md`](.agents/skills/cli/SKILL.md).
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
