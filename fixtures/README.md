# fixtures

Versioned transcript → CSV tagging schemes for experiments.

Current scheme: **v1** (`who`, `intent`, `kind`, `tool`, `sh`, `end`).

## Usage

From the repo root:

```sh
bun cli fixtures prepare -v v1 -a
bun cli fixtures prepare -v v1 -t <transcript-uuid>
```

Jobs land under `fixtures/v1/runs/<jobId>/` (gitignored).

## Docs

- [How to prepare](../docs/how-to/prepare-fixtures.md)
- [Fixtures reference (v1)](../docs/reference/fixtures.md)
- [Layout conventions](../docs/reference/layout.md)
- [Why this pipeline](../docs/explanation/encoding-and-pipelines.md)

## Layout

| Path | Role |
| --- | --- |
| `prepare.ts` | Job writer + discovery helpers |
| `pipeline.ts` / `encoders.ts` / `taxonomies.ts` | Shared tagging contracts |
| `v1/` | Current scheme (taxonomy, encoder, loader) |
| `v1/runs/` | Datetime job CSVs |

## License

UNLICENSED © workstream-tokens
