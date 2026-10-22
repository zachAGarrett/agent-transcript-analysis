# Run the Bun WebSocket service

Start the host process:

```sh
bun run service
```

Default listen address: `ws://127.0.0.1:8787/ws` (override with
`WORKSTREAM_SERVICE_HOST` / `WORKSTREAM_SERVICE_PORT`).

Health check: `GET /health` (unsigned).

## Auth

Client→server traffic uses a thin GNAP (RFC 9635) M2M profile in
`@workstream/service-auth` (see [ADR 0001](../adr/0001-gnap-m2m-service-auth.md)):

| Hop | Mechanism |
| --- | --- |
| `POST /gnap` | RFC 9421 httpsig over grant body with embedded `client.key` (open policy) |
| HTTP upgrade to `/ws` | `Authorization: GNAP <token>` + RFC 9421 httpsig (key-bound token) |
| Each client WS frame | EdDSA JWS Compact over the JSON `ClientRequest` (session-bound key) |

Missing/invalid grant or upgrade credentials get `401`. Unsigned frames are rejected.

v1 policy is **open**: any client that proves control of an Ed25519 key receives
a short-lived key-bound access token. No static emitter allowlist.

Keys under `.data/workstream/` (optional local convenience):

- `service-ed25519.json` — service identity
- `emitter-ed25519.json` — local CLI / emit-example private key (not auto-trusted)

Clients should use the `Emitter` class
([`apps/service/src/emitter.ts`](../../apps/service/src/emitter.ts)), which owns
GNAP grant, upgrade signing, JWS frames, and reply demux.

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
