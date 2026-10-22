# Documentation

Diátaxis layout for `workstream-tokens`.

Agent operators: load [`.agents/skills/cli/SKILL.md`](../.agents/skills/cli/SKILL.md)
for the WebSocket service CLI; use [`.agents/skills/agent-review/documentation/SKILL.md`](../.agents/skills/agent-review/documentation/SKILL.md)
when changing these pages.

## How-to guides

- [Run the Bun WebSocket service](how-to/run-service.md)
- [Explore lattice runs](how-to/explore-runs.md)

## Reference

- [Layout and conventions](reference/layout.md)
- [Host contracts and concurrency](reference/host.md)

## Architecture decisions

Workstream-scoped ADRs live under `.data/agent-review/workstreams/<id>/adr.md` while a
workstream is active. Project-level ADRs live in [`adr/`](adr/).

- [ADR 0001: Thin colocated GNAP M2M for service auth](adr/0001-gnap-m2m-service-auth.md)
