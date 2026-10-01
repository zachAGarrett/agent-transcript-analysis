# Host contracts and concurrency

Reference for `@workstream/host` (`packages/host`).

## Contracts

| Type | Role |
| --- | --- |
| `LatticePersistence` | Caller-chosen backend: `sqlite` / `memory` / `turso` (turso not yet on sync stream path) |
| `LatticeRef` | Open lattice + `runExclusive` write mutex + `close` |
| `PreprocessFn<T>` | Host-defined `(item, index) => Promise<string \| null>` (`null` drops) |
| `StreamHandle<T>` | `feed` / `snapshot` / `end` / `close` |

Kernels: `openLattice`, `createStreamRunner`, `orderedConcurrentMap`, `OnlineLearner`, `LiveDecoder`.

## Concurrency

1. One logical writer per stream — `feed` is not re-entrant.
2. Many streams may share one lattice; all lattice mutations go through `LatticeRef.runExclusive`.
3. Preprocess may run concurrently; learn/decode stay ordered within a stream.
4. The Bun service upgrade mutex serializes connection accept only; it does not replace lattice/stream locks.

## Service transport

See [Run the Bun WebSocket service](../how-to/run-service.md). Framing is host-defined JSON over a persistent WebSocket.
