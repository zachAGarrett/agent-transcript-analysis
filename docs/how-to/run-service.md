# Run the Bun WebSocket service

Start the host process:

```sh
bun run service
```

Default listen address: `ws://127.0.0.1:8787/ws` (override with
`WORKSTREAM_SERVICE_HOST` / `WORKSTREAM_SERVICE_PORT`).

Health check: `GET /health`.

## Management CLI

One WebSocket session per CLI process. Prefer `run` for multi-step flows:

```sh
bun run service:cli -- run '[
  {"op":"createLattice","persistence":{"kind":"memory"}},
  {"op":"createStream","latticeId":"REPLACE_ME"},
  {"op":"feed","streamId":"REPLACE_ME","items":["a.|","b.|"]},
  {"op":"snapshot","streamId":"REPLACE_ME"}
]'
```

Single ops also open a session (state does not survive across CLI invocations).

Ops: `createLattice`, `createStream`, `feed`, `snapshot`, `end`, `closeStream`,
`closeLattice`, `list`.

Default preprocess accepts string symbols or `{ "symbol": "…" }` objects.
