import type { TimelineChartKind } from "@workstream/lattice-viz";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  accuracySeries,
  TIMELINE_ACCURACY_WINDOW,
  TIMELINE_HIT_K,
  type TimelineFrame,
} from "@/app/adapters/runtime-timeline";
import { PatternTransitionGraph } from "@/app/components/PatternTransitionGraph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

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
      hide
    />
  );
}

function chartTitle(chart: TimelineChartKind): string {
  if (chart === "accuracy") return "Timeline accuracy";
  if (chart === "length") return "Pattern length by step";
  return "Decode timeline";
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Query failed.");
  return data as T;
}

type Props = {
  runId: string;
  chart: TimelineChartKind;
  /** Open pattern detail dialog for a lattice node. */
  onOpenPattern: (runId: string, nodeId: number) => void;
};

export function TimelineScrubber({ runId, chart, onOpenPattern }: Props) {
  const [frames, setFrames] = useState<TimelineFrame[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

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

  return (
    <section
      id="timeline"
      className="flex min-h-[min(70vh,720px)] w-full flex-col gap-4"
      aria-label="Decode timeline"
    >
      <div className="min-w-0">
        <h2 className="text-base font-medium">{chartTitle(chart)}</h2>
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

          <div className="relative space-y-2">
            {chart === "length" ? (
              <ChartContainer
                config={lengthConfig}
                className="aspect-auto h-32 w-full"
                initialDimension={{ width: 640, height: 128 }}
              >
                <LineChart
                  data={lengthData}
                  onClick={(state) => {
                    const idx = state?.activeTooltipIndex;
                    if (typeof idx === "number") setCursor(idx);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <TimelineXAxis max={max} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    className="text-[10px]"
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => {
                          const row = payload?.[0]?.payload as
                            | { index?: number; length?: number }
                            | undefined;
                          return row
                            ? `#${row.index} · span ${row.length}`
                            : "Decoded pattern length";
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
            ) : null}

            {chart === "accuracy" ? (
              <ChartContainer
                config={accuracyConfig}
                className="aspect-auto h-32 w-full"
                initialDimension={{ width: 640, height: 128 }}
              >
                <LineChart
                  data={accuracyData}
                  onClick={(state) => {
                    const idx = state?.activeTooltipIndex;
                    if (typeof idx === "number") setCursor(idx);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <TimelineXAxis max={max} />
                  <YAxis
                    domain={[0, 1]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => number(Number(v))}
                    className="text-[10px]"
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(_, payload) => {
                          const row = payload?.[0]?.payload as
                            | { index?: number; hit1?: number; hitK?: number; window?: number }
                            | undefined;
                          return row
                            ? `#${row.index} · hit@1 ${number(row.hit1 ?? 0)} · hit@${TIMELINE_HIT_K} ${number(row.hitK ?? 0)} · n=${row.window ?? 0}`
                            : "Predictive accuracy";
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
                  <ReferenceLine
                    x={cursor}
                    stroke="var(--primary)"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                  />
                </LineChart>
              </ChartContainer>
            ) : null}

            {/* Track matches plot gutters when a chart is above; room for step buttons always. */}
            <div className="flex items-center gap-2 w-full">
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={cursor <= 0}
                onClick={() => setCursor((c) => Math.max(0, c - 1))}
                aria-label="Previous frame"
                className="flex-shrink-0"
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
                variant="outline"
                disabled={cursor >= max}
                onClick={() => setCursor((c) => Math.min(max, c + 1))}
                aria-label="Next frame"
                className="flex-shrink-0"
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>

          {frame ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">
                  #{frame.index} · {cursor + 1}/{frames.length}
                </Badge>
                <code className="truncate font-mono text-xs">{frame.symbol}</code>
                <Badge variant="outline">len {frame.symbolCount}</Badge>
                <Badge variant="outline">cov {number(frame.multiSymbolCoverage)}</Badge>
                <Badge variant="outline">atomic {number(frame.atomicFallbackRate)}</Badge>
                <Badge variant="outline">score {number(frame.score)}</Badge>
                {chart === "accuracy" && accuracyAtCursor ? (
                  <>
                    <Badge variant="outline">hit@1 {number(accuracyAtCursor.hit1)}</Badge>
                    <Badge variant="outline">
                      hit@{TIMELINE_HIT_K} {number(accuracyAtCursor.hitK)}
                    </Badge>
                    <Badge variant="outline">
                      window {accuracyAtCursor.window}/{TIMELINE_ACCURACY_WINDOW}
                    </Badge>
                  </>
                ) : null}
                {!frame.complete ? <Badge variant="destructive">incomplete</Badge> : null}
              </div>

              {chart === "graph" ? (
                <>
                  <Separator />
                  {lookupError ? <p className="text-destructive text-xs">{lookupError}</p> : null}
                  <PatternTransitionGraph
                    prevToken={prevToken}
                    currentToken={currentToken}
                    next={frame.next}
                    onPatternClick={onPatternClick}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </section>
  );
}
