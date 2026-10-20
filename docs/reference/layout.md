# Layout and conventions

Reference for repository paths used by the host package, Bun service, and explorer.

## Top-level

| Path | Role |
| --- | --- |
| `packages/host` | `@workstream/host` — lattice/stream contracts + kernels |
| `packages/service-auth` | `@workstream/service-auth` — Ed25519 JWS + RFC 9421 mesh crypto |
| `apps/service` | Bun WebSocket host + Emitter / management CLI |
| `app/` | Lattice explorer: fixed Lattice / Connectivity / Replay views |
| `api/` | Optional host helpers (e.g. Jev classifiers) |
| `docs/` | Diátaxis docs (how-to, reference, explanation) |
| `runtime/<version>/runs/` | Optional on-disk replay/job outputs (gitignored) |

### Explorer data path

```text
ChartQuery → /api/view → RunStore.query → app/adapters/sqlite-plan.ts → SQLite → View
```

Fixed multi-chart views are defined in `app/views.ts`. Chart models and labels live in
`app/viz/`. Default run root: `runtime/v1/runs` (override with `EXPLORER_RUNS`).

## Host package

```text
packages/host/src/
  contracts.ts       # LatticePersistence, LatticeRef, PreprocessFn, StreamHandle
  lattice.ts         # openLattice + write mutex
  stream.ts          # createStreamRunner
  loop.ts / learner / decoder / predictor
  schemes/           # pattern decode/label helpers for the explorer
```

Hosts implement event schemas and `PreprocessFn` in code. Shared lattices serialize
writes via `LatticeRef.runExclusive`.

## Service (WebSocket)

```text
apps/service/src/
  server.ts          # Bun.serve + upgrade mutex + /ws
  session.ts         # per-socket lattice/stream registry
  cli.ts             # management CLI (WS client)
```

One logical session per socket. Control/data plane is persistent WebSocket JSON
(not REST). Start with `bun run service`; manage with `bun run service:cli`.

## Runtime job directories

- Path: `runtime/<version>/runs/<jobId>/`.
- Produced by `replayMessages` (or a host) when writing review artifacts.
- Explore with `EXPLORER_RUNS=<repo>/runtime/<version>/runs bun run visualize`.
