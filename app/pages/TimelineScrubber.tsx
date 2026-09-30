import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  accuracySeries,
  compressionSeries,
  TIMELINE_ACCURACY_WINDOW,
  TIMELINE_HIT_K,
  type TimelineFrame,
} from "@/app/adapters/runtime-timeline";
import { PatternTransitionGraph } from "@/app/components/PatternTransitionGraph";
import { VisualizationCard } from "@/app/components/VisualizationCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

/** Delay before hold-to-repeat starts (avoids multi-step on a normal click). */
const HOLD_DELAY_MS = 400;
/** Hold-to-repeat interval for scrubber arrow buttons. */
const HOLD_STEP_MS = 50;

/** Pointer hold: step once immediately, then repeat after HOLD_DELAY_MS. */
function useHoldStep(step: () => void) {
  const delay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepRef = useRef(step);
  stepRef.current = step;

  const stop = () => {
    if (delay.current != null) {
      clearTimeout(delay.current);
      delay.current = null;
    }
    if (timer.current != null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  useEffect(
    () => () => {
      if (delay.current != null) clearTimeout(delay.current);
      if (timer.current != null) clearInterval(timer.current);
    },
    [],
  );

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      stepRef.current();
      stop();
      delay.current = setTimeout(() => {
        delay.current = null;
        timer.current = setInterval(() => stepRef.current(), HOLD_STEP_MS);
      }, HOLD_DELAY_MS);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
  };
}

type TimelineMetric = "accuracy" | "length" | "compression";

const TIMELINE_METRICS: { id: TimelineMetric; label: string }[] = [
  { id: "accuracy", label: "Accuracy" },
  { id: "length", label: "Length" },
  { id: "compression", label: "Compression" },
];

const lengthConfig = {
  length: {
    label: "Decoded pattern length",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const accuracyConfig = {
  hit1: {
    label: `Hit@1 (last ${TIMELINE_ACCURACY_WINDOW})`,
    color: "var(--chart-1)",
  },
  hitK: {
    label: `Hit@${TIMELINE_HIT_K} (last ${TIMELINE_ACCURACY_WINDOW})`,
    color: "var(--chart-2)",
  },
  coverage: {
    label: `Coverage (last ${TIMELINE_ACCURACY_WINDOW})`,
    color: "var(--chart-3)",
  },
} satisfies ChartConfig;

const compressionConfig = {
  reduction: {
    label: "Compression reduction",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

function lastPatternLength(steps: TimelineFrame["steps"]): number {
  const last = steps.at(-1);
  if (!last) return 0;
  return last.end - last.start;
}

function TimelineXAxis({ max }: { max: number }) {
  return (
    <XAxis
      dataKey="i"
      type="number"
      domain={[0, Math.max(0, max)]}
      padding={{ left: 0, right: 0 }}
      tickLine={false}
      axisLine={false}
      tick={{ fontSize: 10 }}
      label={{
        value: "Frame",
        position: "insideBottom",
        offset: -12,
        className: "fill-muted-foreground text-[11px]",
      }}
    />
  );
}

const timelineYLabel = (value: string) => ({
  value,
  angle: -90,
  position: "insideLeft" as const,
  offset: 4,
  style: { textAnchor: "middle" as const },
  className: "fill-muted-foreground text-[11px]",
});

const timelineChartMargin = { left: 12, right: 8, top: 4, bottom: 22 };

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Query failed.");
  return data as T;
}

type Props = {
  runId: string;
  /** Open pattern detail dialog for a lattice node. */
  onOpenPattern: (runId: string, nodeId: number) => void;
};

export function TimelineScrubber({ runId, onOpenPattern }: Props) {
  const [frames, setFrames] = useState<TimelineFrame[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [metric, setMetric] = useState<TimelineMetric>("accuracy");

  useEffect(() => {
    let cancelled = false;
    setFrames(null);
    setWarning(null);
    setError(null);
    setLookupError(null);
    setCursor(0);
    void api<{ frames: TimelineFrame[]; warning?: string }>(
      `/api/runtime-timeline?run=${encodeURIComponent(runId)}`,
    )
      .then((data) => {
        if (cancelled) return;
        setFrames(data.frames);
        setWarning(data.warning ?? null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load timeline.");
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const frame = frames?.[cursor] ?? null;
  const max = frames && frames.length > 0 ? frames.length - 1 : 0;

  const lengthData = useMemo(
    () =>
      (frames ?? []).map((f, i) => ({
        i,
        index: f.index,
        length: lastPatternLength(f.steps),
      })),
    [frames],
  );

  const accuracyData = useMemo(() => accuracySeries(frames ?? []), [frames]);
  const compressionData = useMemo(() => compressionSeries(frames ?? []), [frames]);

  const prevToken = frame?.steps.at(-2)?.token;
  const currentToken = frame?.steps.at(-1)?.token;

  const onPatternClick = (token: string) => {
    setLookupError(null);
    void api<{ id: number }>(`/api/pattern-id?${new URLSearchParams({ run: runId, token })}`)
      .then(({ id }) => {
        onOpenPattern(runId, id);
      })
      .catch((err: unknown) => {
        setLookupError(err instanceof Error ? err.message : "Could not open pattern.");
      });
  };

  const accuracyAtCursor = accuracyData[cursor] ?? accuracyData.at(-1);
  const firstAccuracy = accuracyData.find((p) => p.window > 0);
  const compressionAtCursor = compressionData[cursor] ?? compressionData.at(-1);
  const lengthAtCursor = lengthData[cursor];

  const setCursorFromChart = (state: { activeTooltipIndex?: number | string | null }) => {
    const idx = state?.activeTooltipIndex;
    if (typeof idx === "number") setCursor(idx);
  };

  const holdPrev = useHoldStep(() => setCursor((c) => Math.max(0, c - 1)));
  const holdNext = useHoldStep(() => setCursor((c) => Math.min(max, c + 1)));

  return (
    <section
      id="timeline"
      className="flex min-h-[min(70vh,720px)] w-full flex-col gap-6"
      aria-label="Decode replay"
    >
      <div className="min-w-0">
        <h2 className="text-base font-medium">Decode replay</h2>
        <p className="text-muted-foreground font-mono text-xs">{runId}</p>
      </div>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : frames === null ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : frames.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {warning ?? "No events.jsonl for this run — replay a transcript first."}
        </p>
      ) : (
        <>
          {warning ? <p className="text-muted-foreground text-xs">{warning}</p> : null}

          <div className="flex w-full items-center gap-2">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={cursor <= 0}
              onClick={() => setCursor((c) => Math.max(0, c - 1))}
              aria-label="Previous frame"
              className="flex-shrink-0"
              {...holdPrev}
            >
              <ChevronLeftIcon />
            </Button>
            <Slider
              className="w-full"
              value={cursor}
              min={0}
              max={max}
              step={1}
              aria-label="Timeline position"
              onValueChange={(value) => setCursor(value as number)}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              disabled={cursor >= max}
              onClick={() => setCursor((c) => Math.min(max, c + 1))}
              aria-label="Next frame"
              className="flex-shrink-0"
              {...holdNext}
            >
              <ChevronRightIcon />
            </Button>
          </div>

          {frame ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">
                #{frame.index} · {cursor + 1}/{frames.length}
              </Badge>
              <code className="truncate font-mono text-xs">{frame.symbol}</code>
              {metric === "accuracy" && accuracyAtCursor ? (
                <>
                  <Badge variant="outline">hit@1 {number(accuracyAtCursor.hit1)}</Badge>
                  <Badge variant="outline">
                    hit@{TIMELINE_HIT_K} {number(accuracyAtCursor.hitK)}
                  </Badge>
                  {firstAccuracy && accuracyAtCursor.window > 0 ? (
                    <Badge variant="outline">
                      Δhit@1 {number(accuracyAtCursor.hit1 - firstAccuracy.hit1)}
                    </Badge>
                  ) : null}
                </>
              ) : null}
              {metric === "length" && lengthAtCursor ? (
                <Badge variant="outline">span {lengthAtCursor.length}</Badge>
              ) : null}
              {metric === "compression" && compressionAtCursor ? (
                <>
                  <Badge variant="outline">reduction {number(compressionAtCursor.reduction)}</Badge>
                  <Badge variant="outline">mean span {number(compressionAtCursor.meanSpan)}</Badge>
                </>
              ) : null}
              {frame.outcome ? (
                <Badge variant={frame.outcome.hit1 ? "default" : "outline"}>
                  prior{" "}
                  {frame.outcome.hit1
                    ? "hit@1"
                    : frame.outcome.hitK
                      ? `hit@${frame.outcome.rank}`
                      : frame.outcome.covered
                        ? "miss"
                        : "uncovered"}{" "}
                  → {frame.outcome.actualSymbol}
                </Badge>
              ) : null}
              {!frame.complete ? <Badge variant="destructive">incomplete</Badge> : null}
            </div>
          ) : null}

          <VisualizationCard>
            <VisualizationCard.Header>
              <VisualizationCard.Title>Transitions</VisualizationCard.Title>
            </VisualizationCard.Header>
            <VisualizationCard.Content>
              {lookupError ? <p className="text-destructive mb-2 text-xs">{lookupError}</p> : null}
              <PatternTransitionGraph
                prevToken={prevToken}
                currentToken={currentToken}
                next={frame?.next ?? []}
                priorHit={frame?.outcome?.hitK}
                onPatternClick={onPatternClick}
              />
            </VisualizationCard.Content>
          </VisualizationCard>

          <VisualizationCard>
            <VisualizationCard.Header>
              <VisualizationCard.Title>Timeline metrics</VisualizationCard.Title>
              <VisualizationCard.Action>
                <div className="flex items-center gap-2 text-xs">
                  <Label htmlFor="timeline-metric">Measure</Label>
                  <Select
                    value={metric}
                    onValueChange={(value) => {
                      if (value != null) setMetric(value as TimelineMetric);
                    }}
                  >
                    <SelectTrigger id="timeline-metric" size="sm" className="min-w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMELINE_METRICS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </VisualizationCard.Action>
            </VisualizationCard.Header>
            <VisualizationCard.Content>
              <TimelineMetricChart
                metric={metric}
                max={max}
                cursor={cursor}
                accuracyData={accuracyData}
                lengthData={lengthData}
                compressionData={compressionData}
                onChartClick={setCursorFromChart}
              />
            </VisualizationCard.Content>
          </VisualizationCard>
        </>
      )}
    </section>
  );
}

function TimelineMetricChart({
  metric,
  max,
  cursor,
  accuracyData,
  lengthData,
  compressionData,
  onChartClick,
}: {
  metric: TimelineMetric;
  max: number;
  cursor: number;
  accuracyData: ReturnType<typeof accuracySeries>;
  lengthData: { i: number; index: number; length: number }[];
  compressionData: ReturnType<typeof compressionSeries>;
  onChartClick: (state: { activeTooltipIndex?: number | string | null }) => void;
}) {
  if (metric === "accuracy") {
    return (
      <ChartContainer
        config={accuracyConfig}
        className="aspect-auto h-44 w-full"
        initialDimension={{ width: 640, height: 176 }}
      >
        <LineChart
          data={accuracyData}
          onClick={onChartClick}
          style={{ cursor: "pointer" }}
          margin={timelineChartMargin}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <TimelineXAxis max={max} />
          <YAxis
            domain={[0, 1]}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => number(Number(v))}
            className="text-[10px]"
            label={timelineYLabel("Rate")}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as
                    | {
                        index?: number;
                        hit1?: number;
                        hitK?: number;
                        coverage?: number;
                        window?: number;
                      }
                    | undefined;
                  return row
                    ? `#${row.index} · hit@1 ${number(row.hit1 ?? 0)} · hit@${TIMELINE_HIT_K} ${number(row.hitK ?? 0)} · cov ${number(row.coverage ?? 0)} · n=${row.window ?? 0}`
                    : "Next-source-symbol accuracy";
                }}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="hit1"
            stroke="var(--color-hit1)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="hitK"
            stroke="var(--color-hitK)"
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="coverage"
            stroke="var(--color-coverage)"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceLine
            x={cursor}
            stroke="var(--primary)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ChartContainer>
    );
  }

  if (metric === "length") {
    return (
      <ChartContainer
        config={lengthConfig}
        className="aspect-auto h-44 w-full"
        initialDimension={{ width: 640, height: 176 }}
      >
        <LineChart
          data={lengthData}
          onClick={onChartClick}
          style={{ cursor: "pointer" }}
          margin={timelineChartMargin}
        >
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <TimelineXAxis max={max} />
          <YAxis
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            className="text-[10px]"
            label={timelineYLabel("Span")}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => {
                  const row = payload?.[0]?.payload as
                    | { index?: number; length?: number }
                    | undefined;
                  return row ? `#${row.index} · span ${row.length}` : "Decoded pattern length";
                }}
              />
            }
          />
          <Line
            type="monotone"
            dataKey="length"
            stroke="var(--color-length)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceLine
            x={cursor}
            stroke="var(--primary)"
            strokeWidth={1.5}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ChartContainer>
    );
  }

  return (
    <ChartContainer
      config={compressionConfig}
      className="aspect-auto h-44 w-full"
      initialDimension={{ width: 640, height: 176 }}
    >
      <LineChart
        data={compressionData}
        onClick={onChartClick}
        style={{ cursor: "pointer" }}
        margin={timelineChartMargin}
      >
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <TimelineXAxis max={max} />
        <YAxis
          domain={[0, 1]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => number(Number(v))}
          className="text-[10px]"
          label={timelineYLabel("Reduction")}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as
                  | {
                      index?: number;
                      reduction?: number;
                      meanSpan?: number;
                    }
                  | undefined;
                return row
                  ? `#${row.index} · reduction ${number(row.reduction ?? 0)} · mean span ${number(row.meanSpan ?? 0)}`
                  : "Compression reduction";
              }}
            />
          }
        />
        <Line
          type="monotone"
          dataKey="reduction"
          stroke="var(--color-reduction)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <ReferenceLine x={cursor} stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="4 2" />
      </LineChart>
    </ChartContainer>
  );
}
