# ADR 0001: Thin colocated GNAP M2M for service auth

## Status

Accepted

## Context

Emitter clients authenticated to the Bun WebSocket service via a static trust
store (env keys or auto-trusted `emitter-ed25519.json`). That forced co-located
or pre-provisioned keys and blocked remote producers from joining on connect.

RFC 9635 (GNAP) fits “prove a key, negotiate access, present a key-bound token.”
Full Open Payments stacks (e.g. Rafiki auth) are production AS implementations
but pull Postgres/Redis/IdP and payment-domain access types. No small embeddable
GNAP AS library fits this Bun monorepo.

## Decision

We will implement a **thin, colocated GNAP M2M profile** in `apps/service` +
`@workstream/service-auth`:

- `POST /gnap` — open policy: any client that proves Ed25519 key control via
  RFC 9421 over an embedded `client.key` receives a key-bound opaque access token.
- `GET /ws` — require `Authorization: GNAP <token>` plus httpsig bound to that
  token’s key; bind the key to the socket for EdDSA JWS frames.
- Keep existing RFC 9421 + JWS crypto in `@workstream/service-auth`; do not
  vendor Rafiki or `@interledger/open-payments`.

Interaction, continuation, rotation, allowlists, and payment challenges are out
of scope for this decision.

## Consequences

- Remote emitters can obtain a session without sharing filesystem trust material.
- Host policy is intentionally open in v1; tightening (allowlist, payment, VCs)
  can plug in at the grant endpoint later.
- Operators must use `Emitter` (or equivalent grant-then-upgrade); signed upgrade
  alone is no longer sufficient.
- Token state is in-memory; restart invalidates grants (acceptable for local/
  single-process hosts).
