import { dirname, isAbsolute, join, resolve } from "node:path";
import { UNIT_DELIMITER } from "@/fixtures/encoders";
import { listJobIds, RUNS_DIRNAME } from "@/fixtures/prepare";
import { decoder } from "@/fixtures/v1/decoder";

const AXIS_PRIORITY = ["tool:", "kind:", "end:", "intent:", "who:", "sh:"] as const;

function stepLabel(atoms: Array<string | null>): string {
  for (const prefix of AXIS_PRIORITY) {
    const hit = atoms.find((a) => a?.startsWith(prefix));
    if (hit) {
      const colon = hit.indexOf(":");
      return colon < 0 ? hit : hit.slice(colon + 1);
    }
  }
  return "-";
}

/** Human-readable pattern: e.g. `text → Read → Grep`. */
export function labelPattern(token: string): string {
  const units = token.split(UNIT_DELIMITER).filter((u) => u.length > 0);
  if (units.length === 0) return token;
  try {
    return units.map((unit) => stepLabel(decoder.decode(unit))).join(" → ");
  } catch {
    return token;
  }
}

export function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function fmtNum(n: number, digits = 3): string {
  return n.toFixed(digits);
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function horizontalBars(
  items: Array<{ label: string; value: number }>,
  width = 640,
  rowH = 28,
): string {
  if (items.length === 0) return "";
  const max = Math.max(...items.map((i) => i.value), 1);
  const labelW = 220;
  const barMax = width - labelW - 48;
  const height = items.length * rowH + 8;
  const rows = items
    .map((item, i) => {
      const y = 4 + i * rowH;
      const bw = Math.max(2, (item.value / max) * barMax);
      return `
      <text x="0" y="${y + 16}" class="bar-label">${esc(item.label)}</text>
      <rect x="${labelW}" y="${y + 4}" width="${bw}" height="16" rx="2" class="bar"/>
      <text x="${labelW + bw + 6}" y="${y + 16}" class="bar-value">${item.value}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Pattern frequency">${rows}</svg>`;
}

export function table(
  headers: string[],
  rows: string[][],
  aligns: Array<"left" | "right">,
): string {
  const th = headers
    .map((h, i) => `<th style="text-align:${aligns[i] ?? "left"}">${esc(h)}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td style="text-align:${aligns[i] ?? "left"}">${esc(c)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

export function statsGrid(stats: Array<{ label: string; value: string }>): string {
  return `<div class="stats">${stats
    .map(
      (s) =>
        `<div class="stat"><div class="stat-value">${esc(s.value)}</div><div class="stat-label">${esc(s.label)}</div></div>`,
    )
    .join("")}</div>`;
}

const DOCUMENT_CSS = `
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
    margin: 0 auto; max-width: 920px; padding: 24px 20px 48px;
    line-height: 1.45; color: CanvasText; background: Canvas;
  }
  h1 { font-size: 1.35rem; margin: 0 0 4px; font-weight: 650; }
  h2 { font-size: 1.05rem; margin: 28px 0 10px; font-weight: 600; }
  .caption { color: color-mix(in srgb, CanvasText 55%, transparent); font-size: 0.85rem; margin-bottom: 20px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0 8px; }
  .stat { border: 1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius: 8px; padding: 12px 14px; }
  .stat-value { font-size: 1.25rem; font-weight: 650; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 0.78rem; color: color-mix(in srgb, CanvasText 55%, transparent); margin-top: 2px; }
  .bar { fill: color-mix(in srgb, CanvasText 55%, #3b82f6); }
  .bar-label { font-size: 11px; fill: CanvasText; }
  .bar-value { font-size: 11px; fill: color-mix(in srgb, CanvasText 70%, transparent); font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { padding: 8px 10px; border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, transparent); }
  th { text-align: left; font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.03em;
       color: color-mix(in srgb, CanvasText 60%, transparent); }
  td { font-variant-numeric: tabular-nums; }
`;

/** Wrap body HTML in a self-contained document. */
export function documentShell(opts: {
  title: string;
  sourcePath: string;
  heading: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(opts.title)}</title>
<style>${DOCUMENT_CSS}</style>
</head>
<body>
  <h1>${esc(opts.heading)}</h1>
  <p class="caption">Source: ${esc(opts.sourcePath)} · decoder: viterbi</p>
  ${opts.body}
</body>
</html>
`;
}

export type ResolveReportOptions = {
  root: string;
  experiment: string;
  version: string;
  runId?: string;
  /** Explicit path wins over experiment/run resolution. */
  path?: string;
};

/** Resolve a report.json under experiments/<name>/<version>/runs/. */
export async function resolveReportPath(options: ResolveReportOptions): Promise<string> {
  if (options.path) {
    return isAbsolute(options.path) ? options.path : resolve(options.root, options.path);
  }

  const runsDir = join(
    options.root,
    "experiments",
    options.experiment,
    options.version,
    RUNS_DIRNAME,
  );
  const jobs = await listJobIds(runsDir);
  if (jobs.length === 0) {
    throw new Error(`No runs under experiments/${options.experiment}/${options.version}/runs/`);
  }
  const runId = options.runId ?? jobs.at(-1);
  if (!runId || !jobs.includes(runId)) {
    throw new Error(
      `Run "${options.runId}" not found in experiments/${options.experiment}/${options.version}/runs. Known: ${jobs.join(", ")}`,
    );
  }
  return join(runsDir, runId, "report.json");
}

async function openPath(path: string): Promise<void> {
  const cmd =
    process.platform === "darwin"
      ? ["open", path]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", path]
        : ["xdg-open", path];
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

/** Write HTML beside the report JSON and optionally open it. */
export async function writeAndOpenHtml(opts: {
  reportPath: string;
  html: string;
  noOpen?: boolean;
}): Promise<{ htmlPath: string }> {
  const reportPath = resolve(opts.reportPath);
  const htmlPath = join(dirname(reportPath), "report.html");
  await Bun.write(htmlPath, opts.html);
  if (!opts.noOpen) {
    await openPath(htmlPath);
  }
  return { htmlPath };
}
