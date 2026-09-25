import {
  documentShell,
  fmtNum,
  fmtPct,
  horizontalBars,
  labelPattern,
  statsGrid,
  table,
} from "@/experiments/charts";
import type { AnalysisReport } from "@/experiments/session-span/v1/analyze";

function isReport(raw: unknown): raw is AnalysisReport {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r.job === "object" &&
    typeof r.lattice === "object" &&
    typeof r.viterbi === "object" &&
    typeof r.comparison === "object"
  );
}

/** Session-span report charts: cross-turn share, freq bars, hub table. */
export function renderCharts(report: unknown, opts: { sourcePath: string }): string {
  if (!isReport(report)) {
    throw new Error("Invalid session-span report.json");
  }
  const v = report.viterbi;
  const freq = v.patternsByFrequency.slice(0, 8).map((m) => ({
    label: labelPattern(m.token),
    value: m.count,
  }));
  const hubRows = v.patternsByHub
    .slice(0, 10)
    .map((m) => [
      labelPattern(m.token),
      String(m.count),
      m.hubScore !== undefined ? fmtNum(m.hubScore) : "-",
      m.crossesTurn ? "yes" : "no",
    ]);

  const body = `
  ${statsGrid([
    {
      label: "Train / held-out",
      value: `${report.job.trainCount} / ${report.job.heldOutCount}`,
    },
    { label: "Vocabulary", value: String(report.lattice.vocabularySize) },
    { label: "Mean compression", value: `${fmtNum(v.meanCompression)}×` },
    { label: "Cross-turn share", value: fmtPct(v.crossTurnShare) },
    {
      label: "Viterbi∩Beam Jaccard",
      value: fmtNum(report.comparison.topPatternJaccard),
    },
    {
      label: "Divergent sequences",
      value: String(report.comparison.divergentSequenceCount),
    },
  ])}

  <section>
    <h2>Held-out patterns by frequency</h2>
    ${horizontalBars(freq)}
  </section>

  <section>
    <h2>Train hub leaders</h2>
    ${table(["Pattern", "Held-out n", "Hub", "Cross"], hubRows, ["left", "right", "right", "right"])}
  </section>
`;

  return documentShell({
    title: `session-span — ${opts.sourcePath}`,
    sourcePath: opts.sourcePath,
    heading: "session-span report",
    body,
  });
}
