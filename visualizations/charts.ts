import { normalize } from "./algebra";
import type { Facet, View } from "./data";
import type { PathState, SelectionContext } from "./path-space";

const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
export const stamp = (id: string) =>
  `${id.slice(5, 10)} · ${id.slice(11, 16).replace("-", ":")} UTC`;

export function isResidual(key: string) {
  return key === "other" || key.endsWith(":other");
}

function lengthAttr(binKey: string, pathState: PathState | null): string {
  if (pathState?.grain === "length" && !isResidual(binKey)) {
    return ` data-length="${escapeHtml(binKey)}"`;
  }
  if (binKey.includes(":")) {
    const prefix = binKey.split(":")[0] ?? "";
    if (prefix && prefix !== "other") return ` data-length="${escapeHtml(prefix)}"`;
  }
  return "";
}

function chart(
  facet: Facet,
  max: number,
  normalized: boolean,
  selection: SelectionContext | null,
  pathState: PathState | null,
) {
  const rows = normalize(facet.bins, facet.total);
  const width = 430;
  const start = 128;
  const span = 238;
  const height = 35 + rows.length * 33;
  const axis = [0, 0.5, 1]
    .map((fraction) => {
      const x = start + span * fraction;
      const value = max * fraction;
      return `<line x1="${x}" y1="22" x2="${x}" y2="${height}" stroke="#e3e8da"/><text x="${x}" y="12" text-anchor="middle" font-size="10" fill="#97a18b">${normalized ? `${number(value * 100)}%` : number(value)}</text>`;
    })
    .join("");
  const bars = rows
    .map((bin, i) => {
      const y = 32 + i * 33;
      const value = normalized ? bin.fraction : bin.value;
      const residual = isResidual(bin.key);
      const selectedBin =
        selection?.binKey === bin.key && selection.runId === facet.run.id ? " selected" : "";
      const nodeAttr = bin.id !== undefined ? ` data-node="${bin.id}"` : "";
      const rowAttrs = residual
        ? `data-run="${escapeHtml(facet.run.id)}" data-bin="${escapeHtml(bin.key)}"`
        : `class="chart-row${selectedBin}" role="button" tabindex="0" data-run="${escapeHtml(facet.run.id)}" data-bin="${escapeHtml(bin.key)}"${nodeAttr}${lengthAttr(bin.key, pathState)} aria-label="Select bin ${escapeHtml(bin.label)}"`;
      return `<g ${rowAttrs}><title>${escapeHtml(bin.token ?? bin.label)}</title><text x="0" y="${y + 13}" font-size="12" fill="#64765e">${escapeHtml(bin.label)}</text><rect x="${start}" y="${y}" height="18" width="${Math.max(0, (value / max) * span)}" rx="3" fill="${residual ? "#c6ceba" : "#3c7157"}"/><text x="${start + (value / max) * span + 7}" y="${y + 13}" font-size="10" fill="#5a7153">${normalized ? `${number(value * 100)}%` : number(value)}</text></g>`;
    })
    .join("");
  return `<article class="facet"><h3>${escapeHtml(stamp(facet.run.id))}</h3><p class="subtitle">${escapeHtml(facet.unit)} · shared ${normalized ? "relative" : "absolute"} scale</p><svg viewBox="0 0 ${width} ${height}" role="group">${axis}${bars}</svg><p class="total">${number(facet.total)} ${escapeHtml(facet.unit)} · ${facet.bins.length} bins</p></article>`;
}

export function overviewMarkup(view: View, selected: string) {
  const metrics = [
    ["nodes", "Vocabulary size", "Distinct patterns"],
    ["mass", "Stored count mass", "Sum of token_count"],
    ["edges", "Edges", "Distinct directed edges"],
  ] as const;
  return `<div class="overview">${metrics
    .map(([key, label, note]) => {
      const max = Math.max(1, ...view.facets.map((facet) => facet.run[key]));
      return `<article class="metric"><h3>${label} <span class="subtitle">/ ${note}</span></h3>${view.facets.map(({ run }) => `<div class="metric-row ${run.id === selected ? "selected" : ""}"><span>${escapeHtml(stamp(run.id))}</span><div class="track"><span style="width:${(100 * run[key]) / max}%"></span></div><strong>${number(run[key])}</strong></div>`).join("")}</article>`;
    })
    .join("")}</div>`;
}

export function chartsMarkup(
  view: View,
  normalized: boolean,
  selection: SelectionContext | null,
  pathState: PathState | null,
) {
  const max = Math.max(
    0.0001,
    ...view.facets.flatMap((facet) =>
      facet.bins.map((bin) =>
        normalized ? (facet.total ? bin.value / facet.total : 0) : bin.value,
      ),
    ),
  );
  return `<div class="facet-grid">${view.facets.map((facet) => chart(facet, max, normalized, selection, pathState)).join("")}</div>`;
}

export function contractsMarkup(view: View, followups: string[]) {
  return `<h4>Path</h4><pre>${escapeHtml(JSON.stringify(view.plan, null, 2))}</pre><h4>SQL</h4><pre>${escapeHtml(view.facets[0]?.sql ?? "No query")}</pre><h4>Enabled follow-ups</h4><pre>${escapeHtml(JSON.stringify(followups, null, 2))}</pre><h4>Runs</h4>${view.facets.map(({ run }) => `<p><b>${escapeHtml(stamp(run.id))}</b> — ${escapeHtml(run.fixture ?? "No report")}</p>`).join("")}`;
}
