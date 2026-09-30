import {
  type FacetChartModel,
  type FacetChartRow,
  formatChartValue,
  type OverviewMetricModel,
  stamp,
  type View,
} from "@workstream/lattice-viz";
import { AlertCircleIcon, ChartColumnIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import { formatPatternBriefChain } from "@/app/adapters/decode";
import { VisualizationCard } from "@/app/components/VisualizationCard";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

type BinSelect = {
  runId: string;
  binKey: string;
  patternId?: number;
  lengthKey?: string;
};

export function RunCharts({
  view,
  overview,
  facets,
  overviewMetrics,
  loading,
  error,
  emptyMessage,
  onSelectBin,
  onSelectRun,
}: {
  view: View | null;
  overview: boolean;
  facets: FacetChartModel[];
  overviewMetrics: OverviewMetricModel[];
  loading: boolean;
  error: string | null;
  emptyMessage: string | null;
  onSelectBin: (next: BinSelect) => void;
  onSelectRun: (runId: string) => void;
}) {
  if (loading) {
    return (
      <p id="charts" className="text-muted-foreground py-8 text-sm" aria-live="polite">
        Querying…
      </p>
    );
  }
  if (error) {
    return (
      <Empty id="charts" className="border-0 py-10" aria-live="polite">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircleIcon />
          </EmptyMedia>
          <EmptyTitle>View unavailable</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (!view) {
    return (
      <Empty id="charts" className="border-0 py-10" aria-live="polite">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ChartColumnIcon />
          </EmptyMedia>
          <EmptyTitle>No chart yet</EmptyTitle>
          <EmptyDescription>{emptyMessage ?? "Pick a view to load charts."}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (overview) {
    return (
      <div
        id="charts"
        className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr))]"
        aria-live="polite"
      >
        {overviewMetrics.map((metric) => (
          <OverviewMetricCard key={metric.key} metric={metric} onSelectRun={onSelectRun} />
        ))}
      </div>
    );
  }
  return (
    <div
      id="charts"
      className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr))]"
      aria-live="polite"
    >
      {facets.map((facet) => (
        <FacetBarChart key={facet.runId} facet={facet} onSelectBin={onSelectBin} />
      ))}
    </div>
  );
}

function FacetBarChart({
  facet,
  onSelectBin,
}: {
  facet: FacetChartModel;
  onSelectBin: (next: BinSelect) => void;
}) {
  const height = Math.max(160, 48 + facet.rows.length * 36);
  // Tick column + gutter for the rotated category-axis title (insideLeft).
  const tickWidth = Math.min(
    140,
    Math.max(56, ...facet.rows.map((row) => Math.ceil(row.label.length * 7) + 12)),
  );
  const yWidth = tickWidth + 22;
  const config = {
    value: {
      label: facet.valueAxisLabel,
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;
  return (
    <VisualizationCard>
      <VisualizationCard.Header>
        <VisualizationCard.Title>{facet.title}</VisualizationCard.Title>
        <VisualizationCard.Description>{facet.subtitle}</VisualizationCard.Description>
      </VisualizationCard.Header>
      <VisualizationCard.Content>
        <ChartContainer
          config={config}
          className="aspect-auto w-full"
          style={{ height }}
          initialDimension={{ width: 420, height }}
        >
          <BarChart
            accessibilityLayer
            data={facet.rows}
            layout="vertical"
            margin={{ left: 12, right: 28, top: 4, bottom: 22 }}
          >
            <CartesianGrid horizontal={false} />
            <XAxis
              type="number"
              domain={[0, facet.domainMax]}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => formatChartValue(Number(v), facet.normalized)}
              label={{
                value: facet.valueAxisLabel,
                position: "insideBottom",
                offset: -12,
                className: "fill-muted-foreground text-[11px]",
              }}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={yWidth}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11 }}
              label={{
                value: facet.categoryAxisLabel,
                angle: -90,
                position: "insideLeft",
                offset: 4,
                style: { textAnchor: "middle" },
                className: "fill-muted-foreground text-[11px]",
              }}
            />
            <ChartTooltip
              cursor={{ fill: "var(--muted)" }}
              content={
                <ChartTooltipContent
                  className="max-w-sm"
                  formatter={(value) => formatChartValue(Number(value), facet.normalized)}
                  labelFormatter={(_, payload) => {
                    const row = payload?.[0]?.payload as FacetChartRow | undefined;
                    if (!row) return "";
                    const intent =
                      (!row.residual ? formatPatternBriefChain(row.token) : null) ||
                      row.hoverLabel ||
                      row.label;
                    const patternRef = !row.residual && row.id != null ? `#${row.id}` : null;
                    return (
                      <>
                        <div>{patternRef ? `${patternRef} · ${intent}` : intent}</div>
                        {row.token && !row.residual ? (
                          <div className="text-muted-foreground mt-0.5 font-mono text-[10px] font-normal break-all">
                            {row.token}
                          </div>
                        ) : null}
                      </>
                    );
                  }}
                />
              }
            />
            <Bar
              dataKey="value"
              radius={4}
              maxBarSize={18}
              onClick={(data) => {
                const row = data?.payload as FacetChartRow | undefined;
                if (!row || row.residual) return;
                onSelectBin({
                  runId: row.runId,
                  binKey: row.key,
                  patternId: row.id,
                  lengthKey: row.lengthKey,
                });
              }}
            >
              {facet.rows.map((row) => (
                <Cell
                  key={row.key}
                  cursor={row.residual ? "default" : "pointer"}
                  fill={
                    row.residual
                      ? "var(--muted-foreground)"
                      : row.selected
                        ? "var(--foreground)"
                        : "var(--color-value)"
                  }
                  fillOpacity={row.residual ? 0.35 : 1}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </VisualizationCard.Content>
      <VisualizationCard.Footer>{facet.footer}</VisualizationCard.Footer>
    </VisualizationCard>
  );
}

function OverviewMetricCard({
  metric,
  onSelectRun,
}: {
  metric: OverviewMetricModel;
  onSelectRun: (runId: string) => void;
}) {
  const single = metric.rows.length === 1 ? metric.rows[0] : null;
  const highlight = single ?? metric.rows.find((r) => r.selected) ?? metric.rows[0];
  return (
    <VisualizationCard size="sm">
      <VisualizationCard.Header>
        <VisualizationCard.Title className="text-muted-foreground font-normal">
          {metric.label}
        </VisualizationCard.Title>
      </VisualizationCard.Header>
      <VisualizationCard.Content>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">
          {highlight ? formatChartValue(highlight.value, false) : "—"}
        </p>
        {single ? (
          <p className="text-muted-foreground mt-1 text-xs">{metric.note}</p>
        ) : (
          <ul className="mt-1 space-y-1">
            <li className="text-muted-foreground text-[11px]">{metric.note}</li>
            {metric.rows.map((row) => (
              <li key={row.runId}>
                <button
                  type="button"
                  className={`flex w-full items-baseline justify-between gap-2 text-left text-[11px] ${
                    row.selected ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                  onClick={() => onSelectRun(row.runId)}
                >
                  <span className="truncate font-mono text-[10px]">{row.label}</span>
                  <span className="tabular-nums">{formatChartValue(row.value, false)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </VisualizationCard.Content>
    </VisualizationCard>
  );
}

export function ContractInspect({ view }: { view: View | null }) {
  if (!view) {
    return <p className="text-muted-foreground text-xs">Waiting for query.</p>;
  }
  return (
    <div className="space-y-3 text-xs">
      <section>
        <h4 className="mb-1 font-medium">Plan</h4>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {JSON.stringify(view.plan, null, 2)}
        </pre>
      </section>
      <section>
        <h4 className="mb-1 font-medium">SQL</h4>
        <pre className="bg-muted overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
          {view.facets[0]?.sql ?? "No query"}
        </pre>
      </section>
      <section>
        <h4 className="mb-1 font-medium">Runs</h4>
        <ul className="text-muted-foreground space-y-1">
          {view.facets.map(({ run }) => (
            <li key={run.id}>
              <span className="text-foreground font-medium">{stamp(run.id)}</span>
              {" — "}
              {run.fixture ?? "No report"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
