# How to chart an experiment report

Render `report.json` to `report.html` through the experiment’s own `renderCharts`.

## Latest run

```sh
bun cli experiments agent-turn charts
bun cli experiments session-span charts
```

Opens the HTML in the default browser. Use `--no-open` to only write the file.

## Specific run

```sh
bun cli experiments agent-turn charts -rj 2026-09-25T15-28-52Z
bun cli experiments session-span charts -v v1 -rj 2026-09-25T15-28-57Z --no-open
```

## Explicit path

```sh
bun cli experiments agent-turn charts --no-open experiments/agent-turn/v1/runs/<jobId>/report.json
```

The experiment name still selects which `renderCharts` implementation runs.

## What you get

- Shared chrome via [`experiments/charts.ts`](../../experiments/charts.ts)
- Agent-turn: leak, frequency bars, hubs, intent → pattern
- Session-span: cross-turn share, frequency bars, hubs with Cross column

HTML is written beside `report.json` (gitignored under `runs/`).
