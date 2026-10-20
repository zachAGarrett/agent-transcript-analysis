---
name: cli
description: >-
  Operate the workstream-tokens Bun WebSocket service and management CLI.
  Use when the user asks to start the host, create lattices/streams over WS,
  feed symbols, or how to invoke `bun run service` / `service:cli`.
---

# Service CLI (workstream-tokens)

Operator skill for [`apps/service`](../../../apps/service) — Bun WebSocket host
plus management CLI client.

**Do not invent ops.** Prefer [docs/how-to/run-service.md](../../../docs/how-to/run-service.md)
and [docs/reference/layout.md](../../../docs/reference/layout.md).

## When to use

- Start / stop the WebSocket host
- Create lattices and streams, feed symbols, snapshot, end/close
- Explain session-per-socket semantics

## Quick commands

```sh
bun run service
bun run service:emit
bun run service:cli -- list
bun run service:cli -- run '[{"op":"createLattice","persistence":{"kind":"memory"}}]'
```

Default URL: `ws://127.0.0.1:8787/ws` (`WORKSTREAM_SERVICE_URL` / `--url`).
`service:emit` is the example **Emitter** (signed upgrade + JWS frames, synthetic symbols).
Clients must use `Emitter` (or equivalent signing); unsigned WS upgrades are rejected.

## Doc map

| Need | Doc |
| --- | --- |
| Run service + CLI | [docs/how-to/run-service.md](../../../docs/how-to/run-service.md) |
| Paths / packages | [docs/reference/layout.md](../../../docs/reference/layout.md) |
| Explore lattices | [docs/how-to/explore-runs.md](../../../docs/how-to/explore-runs.md) |
| Docs index | [docs/README.md](../../../docs/README.md) |

## Operator rules

1. One logical session per WebSocket — use `run` / `Emitter` for multi-step management.
2. Upgrade is RFC 9421-signed; each client frame is EdDSA JWS (`@workstream/service-auth`).
3. Default preprocess accepts string symbols or `{ "symbol": "…" }`.
4. Shared-lattice writes stay under `LatticeRef.runExclusive`; the upgrade mutex
   only serializes connection accept / registry churn.
5. When changing service ops or paths, update the matching how-to + layout docs.
