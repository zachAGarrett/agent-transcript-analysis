import type { AnalysisReport } from "@/experiments/agent-turn/v1/analyze";
import {
  documentShell,
  fmtNum,
  fmtPct,
  horizontalBars,
  labelPattern,
  statsGrid,
  table,
} from "@/experiments/charts";

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

/** Agent-turn report charts: leak, freq bars, hub table, intent → pattern. */
export function renderCharts(report: unknown, opts: { sourcePath: string }): string {
  if (!isReport(report)) {
    throw new Error("Invalid agent-turn report.json");
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
    ]);
  const intentRows = v.intentToPatterns
    .slice(0, 12)
    .map((p) => [p.intent, labelPattern(p.pattern), String(p.count)]);

  const body = `
  ${statsGrid([
    {
      label: "Train / held-out",
      value: `${report.job.trainCount} / ${report.job.heldOutCount}`,
    },
    { label: "Vocabulary", value: String(report.lattice.vocabularySize) },
    { label: "Mean compression", value: `${fmtNum(v.meanCompression)}×` },
    { label: "User-atom leak", value: fmtPct(v.userAtomLeakShare) },
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
    ${table(["Pattern", "Held-out n", "Hub"], hubRows, ["left", "right", "right"])}
  </section>

  <section>
    <h2>Intent → pattern</h2>
    ${table(["Intent", "Pattern", "Count"], intentRows, ["left", "left", "right"])}
  </section>
`;

  return documentShell({
    title: `agent-turn — ${opts.sourcePath}`,
    sourcePath: opts.sourcePath,
    heading: "agent-turn report",
    body,
  });
}
