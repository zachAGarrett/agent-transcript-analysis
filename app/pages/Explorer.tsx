import {
  facetChartModels,
  Morphism,
  overviewMetricModels,
  planIsOverview,
  planNormalized,
  type Run,
  type View,
} from "@workstream/lattice-viz";
import { ChevronRightIcon, DatabaseIcon, RefreshCcwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContractInspect, RunCharts } from "@/app/components/RunCharts";
import {
  createExplorerSession,
  type ExplorerSession,
  patchDisplay,
  selectRun,
  setView,
} from "@/app/session/explorer";
import {
  buildChartPlan,
  buildLengthPatternsPlan,
  CATEGORY_VIEWS,
  type ChartSpec,
  CONN_MEASURES,
  type ConnMeasureId,
  connMeasure,
  EXPLORER_VIEWS,
  type ExplorerViewId,
  type PatternLoadMorphism,
  resolveChartPreset,
} from "@/app/views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PatternDetail, runVersion } from "./PatternDetail";
import { TimelineScrubber } from "./TimelineScrubber";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

/** Sentinel length key: global top-k (not a composite length drill). */
const LENGTH_ALL = "all";

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Query failed.");
  return data as T;
}

type ChartSlot = {
  id: string;
  title: string;
  view: View | null;
  loading: boolean;
  error: string | null;
};

type DetailOpen = { runId: string; nodeId: number };

function loadForPatterns(spec: ChartSpec, measureId: ConnMeasureId): PatternLoadMorphism {
  if (spec.measurePicker) return connMeasure(measureId).load;
  return Morphism.loadPatternMass;
}

export function Explorer() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [session, setSession] = useState<ExplorerSession>(createExplorerSession);
  const [charts, setCharts] = useState<ChartSlot[]>([]);
  const [queryStatus, setQueryStatus] = useState("");
  const [detailOpen, setDetailOpen] = useState<DetailOpen | null>(null);
  const [patternLengthKey, setPatternLengthKey] = useState(LENGTH_ALL);
  const [connMeasureId, setConnMeasureId] = useState<ConnMeasureId>("outgoing");
  /**
   * Length Select options — stored in state (not derived from `charts`) so clearing
   * chart slots on reload does not collapse the Select to only "All" and reset the value.
   */
  const [lengthOptions, setLengthOptions] = useState<string[]>([]);
  const generation = useRef(0);

  const selected = session.selectedRunId;
  const normalized = session.display.normalized;
  const limit = session.display.limit;
  const activeView = session.view;
  const viewMeta = EXPLORER_VIEWS.find((v) => v.id === activeView);

  const loadRuns = useCallback(async () => {
    try {
      const result = await api<{ runs: Run[]; errors: { id: string; error: string }[] }>(
        "/api/runs",
      );
      setRuns(result.runs);
      setSession((prev) => {
        const ids = result.runs.map((r) => r.id);
        const selectedRunId = ids.includes(prev.selectedRunId)
          ? prev.selectedRunId
          : (ids[0] ?? "");
        const hasEvents = Boolean(result.runs.find((r) => r.id === selectedRunId)?.hasEvents);
        return {
          ...prev,
          catalogRuns: ids,
          selectedRunId,
          runHasEvents: hasEvents,
        };
      });
    } catch {
      /* catalog load failed */
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const hasEvents = Boolean(runs.find((r) => r.id === selected)?.hasEvents);
    setSession((prev) =>
      prev.runHasEvents === hasEvents ? prev : { ...prev, runHasEvents: hasEvents },
    );
  }, [runs, selected]);

  useEffect(() => {
    if (activeView === "replay") {
      setCharts([]);
      setQueryStatus("");
      setLengthOptions([]);
      return;
    }
    if (!runs.length || !session.catalogRuns.length) return;

    const category = CATEGORY_VIEWS[activeView];
    const { display, catalogRuns, selectedRunId } = session;
    const request = ++generation.current;
    const started = performance.now();
    const lengthPickerIds = new Set(category.charts.filter((c) => c.lengthPicker).map((c) => c.id));

    setCharts(
      category.charts.map((c) => ({
        id: c.id,
        title: c.title,
        view: null,
        loading: true,
        error: null,
      })),
    );
    setQueryStatus("");

    void (async () => {
      const baseSlots = await Promise.all(
        category.charts.map(async (spec) => {
          if (spec.lengthPicker) {
            return {
              id: spec.id,
              title: spec.title,
              view: null as View | null,
              loading: true,
              error: null as string | null,
            };
          }
          try {
            const preset = resolveChartPreset(spec, connMeasureId);
            const plan = buildChartPlan(preset, display, catalogRuns, selectedRunId);
            const view = await api<View>(
              `/api/view?plan=${encodeURIComponent(JSON.stringify(plan))}`,
            );
            return {
              id: spec.id,
              title: spec.title,
              view,
              loading: false,
              error: null as string | null,
            };
          } catch (err) {
            return {
              id: spec.id,
              title: spec.title,
              view: null,
              loading: false,
              error: err instanceof Error ? err.message : "This view could not be loaded.",
            };
          }
        }),
      );

      if (request !== generation.current) return;

      const nextLengthOptions = lengthKeysFromView(
        baseSlots.find((s) => s.id === "lengths")?.view,
        selectedRunId,
      );
      if (nextLengthOptions.length > 0) setLengthOptions(nextLengthOptions);

      let lengthKey = patternLengthKey;
      if (
        lengthKey !== LENGTH_ALL &&
        nextLengthOptions.length > 0 &&
        !nextLengthOptions.includes(lengthKey)
      ) {
        lengthKey = LENGTH_ALL;
        setPatternLengthKey(LENGTH_ALL);
      }

      const slots = await Promise.all(
        baseSlots.map(async (slot) => {
          if (!lengthPickerIds.has(slot.id)) return slot;
          const spec = category.charts.find((c) => c.id === slot.id);
          if (!spec) return { ...slot, loading: false, error: "Unknown chart." };
          try {
            const plan =
              lengthKey === LENGTH_ALL || !lengthKey
                ? buildChartPlan(
                    resolveChartPreset(spec, connMeasureId),
                    display,
                    catalogRuns,
                    selectedRunId,
                  )
                : buildLengthPatternsPlan(
                    lengthKey,
                    display,
                    catalogRuns,
                    selectedRunId,
                    loadForPatterns(spec, connMeasureId),
                  );
            const view = await api<View>(
              `/api/view?plan=${encodeURIComponent(JSON.stringify(plan))}`,
            );
            return { ...slot, view, loading: false, error: null };
          } catch (err) {
            return {
              ...slot,
              view: null,
              loading: false,
              error: err instanceof Error ? err.message : "This view could not be loaded.",
            };
          }
        }),
      );

      if (request !== generation.current) return;
      setCharts(slots);
      const ok = slots.filter((s) => s.view).length;
      setQueryStatus(`${number(performance.now() - started)} ms · ${ok}/${slots.length} charts`);
    })();
  }, [activeView, runs, session, patternLengthKey, connMeasureId]);

  const patchTipDisplay = useCallback((patch: Partial<ExplorerSession["display"]>) => {
    setSession((prev) => patchDisplay(prev, patch));
  }, []);

  const onSelectRun = useCallback(
    (runId: string) => {
      setSession((prev) => {
        const hasEvents = Boolean(runs.find((r) => r.id === runId)?.hasEvents);
        return { ...selectRun(prev, runId), runHasEvents: hasEvents };
      });
    },
    [runs],
  );

  const onChangeView = useCallback((view: ExplorerViewId) => {
    setSession((prev) => setView(prev, view));
  }, []);

  const onSelectBin = useCallback(
    (next: { runId: string; binKey: string; patternId?: number; lengthKey?: string }) => {
      if (next.patternId && next.patternId > 0) {
        setDetailOpen({ runId: next.runId, nodeId: next.patternId });
      }
    },
    [],
  );

  const detailVersion = detailOpen ? runVersion(runs, detailOpen.runId) : "";

  return (
    <>
      <main className="mx-auto max-w-[1540px] px-[4.5%] pt-6 pb-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Explorer views">
              {EXPLORER_VIEWS.map((v) => (
                <Button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={activeView === v.id}
                  variant={activeView === v.id ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => onChangeView(v.id)}
                >
                  {v.title}
                </Button>
              ))}
            </div>
            {viewMeta ? (
              <p className="text-muted-foreground mt-2 text-sm">{viewMeta.description}</p>
            ) : null}
          </div>
        </div>

        <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:gap-10">
          <aside className="min-w-0">
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">
                Runs
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      id="refresh"
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadRuns()}
                    />
                  }
                >
                  Refresh
                  <RefreshCcwIcon />
                </TooltipTrigger>
                <TooltipContent>Reload run databases</TooltipContent>
              </Tooltip>
            </div>
            <div className="scroll-fade h-[min(60vh,520px)] overflow-y-auto">
              <div id="runs" className="flex flex-col gap-2 py-3 pr-1">
                {runs.length ? (
                  runs.map((run, i) => (
                    <Button
                      key={run.id}
                      type="button"
                      variant={run.id === selected ? "secondary" : "ghost"}
                      className="h-auto flex-col items-start gap-1 px-3 py-2 text-left whitespace-normal"
                      aria-pressed={run.id === selected}
                      onClick={() => onSelectRun(run.id)}
                    >
                      <span className="text-sm font-medium">
                        {run.id.slice(0, 10)}{" "}
                        <span className="text-muted-foreground font-normal">
                          {run.id.slice(11, 19).replaceAll("-", ":")}
                        </span>
                      </span>
                      <small className="text-muted-foreground text-[11px]">
                        {number(run.nodes)} patterns · {number(run.mass)} stored counts
                      </small>
                      {i === 0 || run.fixture || run.hasEvents ? (
                        <Badge variant="outline" className="mt-0.5 text-[10px]">
                          {[
                            i === 0 ? "Latest" : null,
                            run.fixture ? "Report" : null,
                            run.hasEvents ? "Events" : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Badge>
                      ) : null}
                    </Button>
                  ))
                ) : (
                  <Empty className="min-h-0 border-0 p-4">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <DatabaseIcon />
                      </EmptyMedia>
                      <EmptyTitle>No readable runs</EmptyTitle>
                      <EmptyDescription>Produce an experiment run, then refresh.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </div>
            </div>
          </aside>

          <section className="min-w-0">
            {!runs.length ? (
              <Empty id="title" className="min-h-[40vh] border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <DatabaseIcon />
                  </EmptyMedia>
                  <EmptyTitle>No readable runs</EmptyTitle>
                  <EmptyDescription>Produce an experiment run, then refresh.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : activeView === "replay" ? (
              session.runHasEvents && selected ? (
                <TimelineScrubber
                  runId={selected}
                  onOpenPattern={(runId, nodeId) => setDetailOpen({ runId, nodeId })}
                />
              ) : (
                <Empty id="replay" className="min-h-[40vh] border-0">
                  <EmptyHeader>
                    <EmptyTitle>No runtime events</EmptyTitle>
                    <EmptyDescription>
                      This run has no events.jsonl. Replay a transcript, or pick a run marked
                      Events.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )
            ) : (
              <>
                <div className="mb-6 flex flex-wrap items-center gap-4 text-xs">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="limit">Show</Label>
                    <Select
                      value={String(limit)}
                      onValueChange={(value) => {
                        if (value != null) patchTipDisplay({ limit: Number(value) });
                      }}
                    >
                      <SelectTrigger id="limit" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">Top 5</SelectItem>
                        <SelectItem value="10">Top 10</SelectItem>
                        <SelectItem value="20">Top 20</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="normalized"
                      checked={normalized}
                      onCheckedChange={(checked) => patchTipDisplay({ normalized: checked })}
                      size="sm"
                    />
                    <Label htmlFor="normalized">Share of run total</Label>
                  </div>
                </div>

                <div className="grid gap-10">
                  {charts.map((slot) => {
                    const spec = CATEGORY_VIEWS[activeView].charts.find((c) => c.id === slot.id);
                    return (
                      <ChartPanel
                        key={slot.id}
                        slot={slot}
                        selectedRunId={selected}
                        lengthPicker={spec?.lengthPicker}
                        measurePicker={spec?.measurePicker}
                        lengthOptions={lengthOptions}
                        lengthKey={patternLengthKey}
                        onLengthKeyChange={setPatternLengthKey}
                        measureId={connMeasureId}
                        onMeasureChange={setConnMeasureId}
                        onSelectBin={onSelectBin}
                        onSelectRun={onSelectRun}
                      />
                    );
                  })}
                </div>

                <p id="query-status" className="text-muted-foreground mt-3 text-xs">
                  {queryStatus}
                </p>

                <Collapsible defaultOpen={false} className="group mt-8">
                  <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                    <ChevronRightIcon className="transition-transform group-data-open:rotate-90" />
                    Inspect
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <ContractInspect view={charts.find((c) => c.view)?.view ?? null} />
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </section>
        </section>
      </main>

      {detailOpen ? (
        <PatternDetail
          runId={detailOpen.runId}
          nodeId={detailOpen.nodeId}
          version={detailVersion}
          onClose={() => setDetailOpen(null)}
          onOpenNeighbor={(runId, nodeId) => setDetailOpen({ runId, nodeId })}
        />
      ) : null}
    </>
  );
}

function lengthKeysFromView(view: View | null | undefined, preferredRunId?: string): string[] {
  if (!view?.facets.length) return [];
  const facet =
    (preferredRunId ? view.facets.find((f) => f.run.id === preferredRunId) : undefined) ??
    view.facets[0];
  if (!facet) return [];
  return facet.bins
    .filter((bin) => bin.key !== "other" && !bin.key.endsWith(":other"))
    .slice()
    .sort((a, b) => b.value - a.value || Number(a.key) - Number(b.key))
    .map((bin) => bin.key);
}

function lengthLabel(key: string): string {
  if (key === LENGTH_ALL) return "All";
  return key === "32" ? "32+" : key;
}

function ChartPanel({
  slot,
  selectedRunId,
  lengthPicker,
  measurePicker,
  lengthOptions,
  lengthKey,
  onLengthKeyChange,
  measureId,
  onMeasureChange,
  onSelectBin,
  onSelectRun,
}: {
  slot: ChartSlot;
  selectedRunId: string;
  lengthPicker?: boolean;
  measurePicker?: boolean;
  lengthOptions?: string[];
  lengthKey?: string;
  onLengthKeyChange?: (key: string) => void;
  measureId?: ConnMeasureId;
  onMeasureChange?: (id: ConnMeasureId) => void;
  onSelectBin: (next: {
    runId: string;
    binKey: string;
    patternId?: number;
    lengthKey?: string;
  }) => void;
  onSelectRun: (runId: string) => void;
}) {
  const overview = slot.view ? planIsOverview(slot.view.plan) : false;
  const facets = useMemo(() => {
    if (!slot.view || overview) return [];
    return facetChartModels(slot.view, planNormalized(slot.view.plan), null, null);
  }, [slot.view, overview]);
  const overviewMetrics = useMemo(() => {
    if (!slot.view || !overview) return [];
    return overviewMetricModels(slot.view, selectedRunId);
  }, [slot.view, overview, selectedRunId]);

  const pickerKeys = [LENGTH_ALL, ...(lengthOptions ?? [])];

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium">{slot.title}</h2>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {measurePicker && measureId && onMeasureChange ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={`measure-${slot.id}`}>Measure</Label>
              <Select
                value={measureId}
                onValueChange={(value) => {
                  if (value != null) onMeasureChange(value as ConnMeasureId);
                }}
              >
                <SelectTrigger id={`measure-${slot.id}`} size="sm" className="min-w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONN_MEASURES.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {lengthPicker && onLengthKeyChange ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={`length-${slot.id}`}>Length</Label>
              <Select
                value={lengthKey || LENGTH_ALL}
                onValueChange={(value) => {
                  if (value != null) onLengthKeyChange(value);
                }}
              >
                <SelectTrigger id={`length-${slot.id}`} size="sm" className="min-w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pickerKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {lengthLabel(key)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      </div>
      <RunCharts
        view={slot.view}
        overview={overview}
        facets={facets}
        overviewMetrics={overviewMetrics}
        loading={slot.loading}
        error={slot.error}
        emptyMessage={null}
        onSelectBin={onSelectBin}
        onSelectRun={onSelectRun}
      />
    </div>
  );
}
