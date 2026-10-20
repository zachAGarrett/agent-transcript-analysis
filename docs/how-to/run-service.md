# Run the Bun WebSocket service

Start the host process:

```sh
bun run service
```

Default listen address: `ws://127.0.0.1:8787/ws` (override with
`WORKSTREAM_SERVICE_HOST` / `WORKSTREAM_SERVICE_PORT`).

Health check: `GET /health` (unsigned).

## Auth

Client→server traffic is authenticated with `@workstream/service-auth`:

| Hop | Mechanism |
| --- | --- |
| HTTP upgrade to `/ws` | RFC 9421 HTTP Message Signatures (ed25519) |
| Each client WS frame | EdDSA JWS Compact over the JSON `ClientRequest` |

Unsigned upgrades get `401`. Unsigned frames are rejected.

Keys default under `.data/workstream/`:

- `service-ed25519.json` — service identity
- `emitter-ed25519.json` — shared local emitter key (auto-trusted as `workstream-emitter` when env trust is empty)

Override trust with `WORKSTREAM_EMITTER_PUBLIC_KEY` (multibase `u…`) or
`WORKSTREAM_MESH_PUBLIC_KEYS` (`{"kid":"u…"}` JSON).

Clients should use the `Emitter` class ([`apps/service/src/emitter.ts`](../../apps/service/src/emitter.ts)), which owns upgrade signing, JWS frames, and reply demux.

## Management CLI

One signed WebSocket session per CLI process. Prefer `run` for multi-step flows:

```sh
bun run service:cli -- run '[
  {"op":"createLattice","persistence":{"kind":"memory"}},
  {"op":"createStream","latticeId":"REPLACE_ME"},
  {"op":"feed","streamId":"REPLACE_ME","items":["a.|","b.|"]},
  {"op":"snapshot","streamId":"REPLACE_ME"}
]'
```

Ops: `createLattice`, `createStream`, `feed`, `snapshot`, `end`, `closeStream`,
`closeLattice`, `list`.

Default preprocess accepts string symbols or `{ "symbol": "…" }` objects.

## Example emitter

```sh
bun run service          # terminal 1
bun run service:emit     # terminal 2 — Emitter + synthetic symbols
```

Optional: `bun run service:emit -- --url ws://127.0.0.1:8787/ws`
