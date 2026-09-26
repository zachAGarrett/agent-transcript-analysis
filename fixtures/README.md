# fixtures

Versioned transcript → CSV tagging schemes for experiments.

Schemes:

- **v1** — `who`, `intent`, `kind`, `tool`, `sh`, `end` (regex intent)
- **v2** — adds `purpose`; `intent` / `purpose` via Jev Choice (`AI_GATEWAY_API_KEY`)

## Usage

From the repo root:

```sh
bun cli fixtures prepare -v v1 -a
bun cli fixtures prepare -v v2 -t <transcript-uuid>
bun cli fixtures prepare -v v2 -t <transcript-uuid> -c 12
```

Jobs land under `fixtures/<version>/runs/<jobId>/` (gitignored).

## Docs

- [How to prepare](../docs/how-to/prepare-fixtures.md)
- [Fixtures reference](../docs/reference/fixtures.md)
- [Layout conventions](../docs/reference/layout.md)
- [Why this pipeline](../docs/explanation/encoding-and-pipelines.md)

## Layout

| Path | Role |
| --- | --- |
| `prepare.ts` | Job writer + discovery helpers |
| `pipeline.ts` / `encoders.ts` / `taxonomies.ts` | Shared tagging contracts |
| `v1/` | Regex-intent scheme |
| `v2/` | Jev intent/purpose scheme |
| `v*/runs/` | Datetime job CSVs (gitignored) |

## License

UNLICENSED © workstream-tokens
