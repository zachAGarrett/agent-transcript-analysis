import {
  autoFollowupAfterSelect,
  enabledNames,
  explorerStarterPresets,
  facetChartModels,
  isUserFollowupChip,
  morphismLabel,
  morphismReloads,
  morphismWhat,
  overviewMetricModels,
  type PathPlan,
  type PathState,
  pathTitle,
  planNormalized,
  type Run,
  revertPathTo,
  type SelectionContext,
  selectionContextFromState,
  stateIsOverview,
  type View,
  visiblePathSteps,
} from "@workstream/lattice-viz";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  MessageCircleQuestionIcon,
  RefreshCcwIcon,
} from "lucide-react";
import { type FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecideResponse, DecideStep } from "@/app/adapters/decide-types";
import { ContractInspect, RunCharts } from "@/app/components/RunCharts";
import {
  createExplorerSession,
  type ExplorerSession,
  effectivePlan,
  patchDisplay,
  selectionOf,
  selectRun,
  sessionAfterFollowup,
  sessionAfterRevert,
  sessionFromDecision,
  sessionFromPreset,
} from "@/app/session/explorer";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PatternDetail, runVersion } from "./PatternDetail";
import { TimelineScrubber } from "./TimelineScrubber";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Query failed.");
  return data as T;
}

type DecideStreamEvent =
  | { type: "step"; step: DecideStep }
  | { type: "done"; result: DecideResponse }
  | { type: "error"; error: string };

type DecideChecklistItem =
  | { key: string; kind: "pending"; label: string }
  | { key: string; kind: "done"; label: string };

async function streamDecide(
  question: string,
  selectedRunId: string,
  onStep: (step: DecideStep) => void,
): Promise<DecideResponse> {
  const params = new URLSearchParams({ question });
  if (selectedRunId) params.set("run", selectedRunId);
  const response = await fetch(`/api/decide?${params}`);
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? "Path proposal failed.");
  }
  if (!response.body) throw new Error("Path proposal failed.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: DecideResponse | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as DecideStreamEvent;
      if (event.type === "step") onStep(event.step);
      else if (event.type === "error") throw new Error(event.error);
      else if (event.type === "done") result = event.result;
    }
  }
  if (buffer.trim()) {
    const event = JSON.parse(buffer) as DecideStreamEvent;
    if (event.type === "step") onStep(event.step);
    else if (event.type === "error") throw new Error(event.error);
    else if (event.type === "done") result = event.result;
  }
  if (!result) throw new Error("Path proposal failed.");
  return result;
}

function samePlan(a: PathPlan | null, b: PathPlan): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

type PathCrumb = { name: string; label: string; index: number };

/** Sentinel breadcrumb index for session tip open_timeline_scrubber (not a plan step). */
const TIMELINE_CRUMB_INDEX = -1;
/** Sentinel for show_timeline_accuracy tip crumb. */
const ACCURACY_CRUMB_INDEX = -2;
/** Sentinel for show_timeline_length tip crumb. */
const LENGTH_CRUMB_INDEX = -3;

function PathActionsBreadcrumb({
  crumbs,
  onRevert,
}: {
  crumbs: PathCrumb[];
  onRevert: (throughIndex: number) => void;
}) {
  const last = crumbs.at(-1);
  const head = crumbs[0];
  const beforeLast = crumbs.length > 3 ? crumbs.at(-2) : undefined;
  if (!last || !head) return null;

  const link = (crumb: PathCrumb, current = false) => (
    <Tooltip>
      <BreadcrumbLink
        className={current ? "font-normal text-foreground" : undefined}
        aria-current={current ? "page" : undefined}
        render={
          <TooltipTrigger render={<button type="button" onClick={() => onRevert(crumb.index)} />} />
        }
      >
        {crumb.label}
      </BreadcrumbLink>
      <TooltipContent>{morphismWhat(crumb.name) ?? `Revert to ${crumb.label}`}</TooltipContent>
    </Tooltip>
  );

  if (beforeLast) {
    const middle = crumbs.slice(1, -2);
    return (
      <Breadcrumb>
        <BreadcrumbList className="text-lg sm:text-xl">
          <BreadcrumbItem>{link(head)}</BreadcrumbItem>
          <BreadcrumbSeparator>→</BreadcrumbSeparator>
          <BreadcrumbItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost">
                    <BreadcrumbEllipsis />
                    <span className="sr-only">Toggle menu</span>
                  </Button>
                }
              />
              <DropdownMenuContent align="start">
                <DropdownMenuGroup>
                  {middle.map((crumb) => {
                    const what = morphismWhat(crumb.name);
                    return (
                      <DropdownMenuItem
                        key={`${crumb.index}-${crumb.name}`}
                        onClick={() => onRevert(crumb.index)}
                      >
                        {what ? (
                          <Tooltip>
                            <TooltipTrigger render={<span className="block w-full" />}>
                              {crumb.label}
                            </TooltipTrigger>
                            <TooltipContent>{what}</TooltipContent>
                          </Tooltip>
                        ) : (
                          crumb.label
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </BreadcrumbItem>
          <BreadcrumbSeparator>→</BreadcrumbSeparator>
          <BreadcrumbItem>{link(beforeLast)}</BreadcrumbItem>
          <BreadcrumbSeparator>→</BreadcrumbSeparator>
          <BreadcrumbItem>{link(last, true)}</BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList className="text-lg sm:text-xl">
        {crumbs.map((crumb, i) => (
          <Fragment key={`${crumb.index}-${crumb.name}`}>
            {i > 0 ? <BreadcrumbSeparator>→</BreadcrumbSeparator> : null}
            <BreadcrumbItem>{link(crumb, i === crumbs.length - 1)}</BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function Explorer() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [session, setSession] = useState<ExplorerSession>(createExplorerSession);
  const [question, setQuestion] = useState("");
  const [queryStatus, setQueryStatus] = useState("");
  const [chartsLoading, setChartsLoading] = useState(false);
  const [chartsError, setChartsError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [viewTick, setViewTick] = useState(0);
  const [deciding, setDeciding] = useState(false);
  const [decideChecklist, setDecideChecklist] = useState<DecideChecklistItem[]>([]);
  const generation = useRef(0);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const tipState = session.pathState;
  const pathState = tipState.steps.length || tipState.tip === "timeline" ? tipState : null;
  const selected = session.selectedRunId;
  const overviewMode = stateIsOverview(pathState);
  const selection = selectionOf(session);
  const compare = session.display.faceted;
  const normalized = session.display.normalized;
  const limit = session.display.limit;
  const currentPlan = tipState.steps.length
    ? { steps: session.steps, runs: session.catalogRuns }
    : null;
  const onTimeline = tipState.tip === "timeline" || tipState.timelineRequested;

  const followups = useMemo(() => {
    return enabledNames(tipState, selectionContextFromState(tipState));
  }, [tipState]);
  const detailOpen =
    tipState.detailRequested && (tipState.selectionPatternId ?? 0) > 0
      ? { runId: tipState.selectionRunId, nodeId: tipState.selectionPatternId }
      : null;
  const timelineRunId = onTimeline
    ? tipState.selectionRunId || selected || session.catalogRuns[0] || ""
    : "";

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
          pathState: { ...prev.pathState, runHasEvents: hasEvents },
        };
      });
      if (sessionRef.current.pathState.steps.length) setViewTick((n) => n + 1);
    } catch {
      /* catalog load failed */
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    const hasEvents = Boolean(runs.find((r) => r.id === selected)?.hasEvents);
    setSession((prev) => {
      if (prev.pathState.runHasEvents === hasEvents) return prev;
      return { ...prev, pathState: { ...prev.pathState, runHasEvents: hasEvents } };
    });
  }, [runs, selected]);

  useEffect(() => {
    if (!runs.length || !session.pathState.steps.length || onTimeline) return;
    void viewTick;
    const request = ++generation.current;
    setChartsLoading(true);
    setChartsError(null);
    setQueryStatus("");
    const started = performance.now();
    const plan = effectivePlan(sessionRef.current);
    void api<View>(`/api/view?plan=${encodeURIComponent(JSON.stringify(plan))}`)
      .then((next) => {
        if (request !== generation.current) return;
        setView(next);
        setSession((prev) => {
          if (samePlan({ steps: prev.steps, runs: effectivePlan(prev).runs }, next.plan)) {
            return prev;
          }
          return { ...prev, steps: next.plan.steps };
        });
        setChartsLoading(false);
        setQueryStatus(
          `${number(performance.now() - started)} ms · ${next.facets.length} run${next.facets.length === 1 ? "" : "s"} · ${next.cacheHit ? "cache" : "SQLite"}`,
        );
      })
      .catch(() => {
        if (request !== generation.current) return;
        setChartsLoading(false);
        setChartsError("This view could not be loaded.");
      });
  }, [session.pathState.steps, runs, viewTick, onTimeline]);

  const applyFollowup = useCallback(
    async (
      action: string,
      nextSelection?: SelectionContext | null,
      basePlan?: PathPlan,
    ): Promise<{ plan: PathPlan; state: PathState; enabled: string[] }> => {
      const tip = sessionRef.current;
      const plan = basePlan ?? effectivePlan(tip);
      const sel = nextSelection !== undefined ? nextSelection : selectionOf(tip);
      const result = await api<{
        plan: PathPlan;
        state: PathState;
        enabled: string[];
      }>(
        `/api/followup?action=${encodeURIComponent(action)}&session=${encodeURIComponent(
          JSON.stringify({
            steps: plan.steps,
            runs: plan.runs.length
              ? plan.runs
              : ([tip.selectedRunId || tip.catalogRuns[0]].filter(Boolean) as string[]),
            selection: sel,
            detailRequested: tip.pathState.detailRequested,
            timelineRequested: tip.pathState.timelineRequested,
            timelineChart: tip.pathState.timelineChart,
            tip: tip.pathState.tip,
            runHasEvents: tip.pathState.runHasEvents,
          }),
        )}`,
      );
      setSession((prev) => {
        const next = sessionAfterFollowup(prev, result.plan, result.state);
        sessionRef.current = next;
        return next;
      });
      if (morphismReloads(action)) {
        setViewTick((n) => n + 1);
      }
      return result;
    },
    [],
  );

  const patchTipDisplay = useCallback((patch: Partial<ExplorerSession["display"]>) => {
    setSession((prev) => patchDisplay(prev, patch));
    setViewTick((n) => n + 1);
  }, []);

  const revertToPathIndex = useCallback(
    (throughIndex: number) => {
      const tip = sessionRef.current;
      if (!tip.steps.length) return;
      try {
        const catalog = runs.map((run) => run.id);
        const { plan, state } = revertPathTo(tip.steps, throughIndex, catalog, tip.catalogRuns);
        setSession((prev) => sessionAfterRevert(prev, plan, state));
        setViewTick((n) => n + 1);
      } catch {
        /* revert failed */
      }
    },
    [runs],
  );

  const onBreadcrumbCrumb = useCallback(
    (throughIndex: number) => {
      if (throughIndex === ACCURACY_CRUMB_INDEX || throughIndex === LENGTH_CRUMB_INDEX) return;
      const tip = sessionRef.current;
      if (throughIndex === TIMELINE_CRUMB_INDEX) {
        if (tip.pathState.timelineChart !== "graph") {
          void applyFollowup("show_timeline_graph");
        }
        return;
      }
      if (tip.pathState.tip === "timeline" || tip.pathState.timelineRequested) {
        return;
      }
      revertToPathIndex(throughIndex);
    },
    [applyFollowup, revertToPathIndex],
  );

  const onAsk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fromForm = String(new FormData(form).get("question") ?? "").trim();
    const q = fromForm || question.trim();
    if (!q) return;
    let stepIndex = 0;
    setDeciding(true);
    setDecideChecklist([{ key: "pending", kind: "pending", label: "Choosing next step…" }]);
    let decision: DecideResponse;
    try {
      decision = await streamDecide(q, selected, (step) => {
        const key = `${stepIndex++}:${step.id}`;
        setDecideChecklist((prev) => {
          const done: DecideChecklistItem[] = [
            ...prev.filter((item) => item.kind !== "pending"),
            { key, kind: "done", label: step.label },
          ];
          if (step.id === "commit") return done;
          return [...done, { key: "pending", kind: "pending", label: "Choosing next step…" }];
        });
      });
    } catch {
      setDeciding(false);
      setDecideChecklist([]);
      return;
    }
    setDeciding(false);
    setDecideChecklist([]);
    if (!decision.plan || !decision.state) return;
    setSession(
      sessionFromDecision(
        decision.plan,
        decision.state,
        runs.map((r) => r.id),
      ),
    );
    setViewTick((n) => n + 1);
  };

  const onSelectBin = useCallback(
    (next: { runId: string; binKey: string; patternId?: number; lengthKey?: string }) => {
      if (!sessionRef.current.steps.length) return;
      const sel: SelectionContext = {
        runId: next.runId,
        binKey: next.binKey,
        patternId: next.patternId,
        lengthKey: next.lengthKey,
      };
      void applyFollowup("select_bin", sel)
        .then(async (selected) => {
          const auto = autoFollowupAfterSelect(selected.enabled);
          if (!auto) return;
          await applyFollowup(auto, sel, selected.plan);
        })
        .catch(() => {
          /* follow-up failed */
        });
    },
    [applyFollowup],
  );

  const onSelectRun = useCallback((runId: string) => {
    setSession((prev) => selectRun(prev, runId));
    setViewTick((n) => n + 1);
  }, []);

  const chartFacets = useMemo(() => {
    if (!view || stateIsOverview(pathState)) return [];
    return facetChartModels(view, planNormalized(view.plan), selection, pathState);
  }, [view, selection, pathState]);

  const chartOverview = useMemo(() => {
    if (!view || !stateIsOverview(pathState)) return [];
    return overviewMetricModels(view, selected);
  }, [view, selected, pathState]);

  const heading = useMemo(() => {
    if (onTimeline) {
      const crumbs: PathCrumb[] = [
        {
          name: "open_timeline_scrubber",
          label: morphismLabel("open_timeline_scrubber"),
          index: TIMELINE_CRUMB_INDEX,
        },
      ];
      if (tipState.timelineChart === "accuracy") {
        crumbs.push({
          name: "show_timeline_accuracy",
          label: morphismLabel("show_timeline_accuracy"),
          index: ACCURACY_CRUMB_INDEX,
        });
      } else if (tipState.timelineChart === "length") {
        crumbs.push({
          name: "show_timeline_length",
          label: morphismLabel("show_timeline_length"),
          index: LENGTH_CRUMB_INDEX,
        });
      }
      return {
        crumbs,
        description: pathTitle(tipState).description,
      };
    }
    if (!currentPlan?.steps.length) {
      return { crumbs: null as PathCrumb[] | null, description: "" };
    }
    const meta = pathTitle(tipState);
    const visible = visiblePathSteps(currentPlan.steps);
    const crumbs: PathCrumb[] = visible.map(({ step, index }) => ({
      name: step.name,
      label: morphismLabel(step.name),
      index,
    }));
    return {
      crumbs,
      description: meta.description,
    };
  }, [currentPlan, tipState, onTimeline]);

  const hasPath = Boolean(heading.crumbs?.length) || onTimeline;

  const visibleFollowups = followups.filter((name) => {
    if (!isUserFollowupChip(name)) return false;
    if (tipState.tip === "query") return name === "open_timeline_scrubber";
    if (onTimeline) {
      return (
        name === "close_timeline_scrubber" ||
        name === "show_timeline_graph" ||
        name === "show_timeline_accuracy" ||
        name === "show_timeline_length"
      );
    }
    return name !== "open_timeline_scrubber";
  });
  const detailVersion = detailOpen ? runVersion(runs, detailOpen.runId) : "";

  return (
    <>
      <Dialog
        open={deciding}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open) return;
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader className="sr-only">
            <DialogTitle>Composing path</DialogTitle>
            <DialogDescription>Exploring the decision tree for your question.</DialogDescription>
          </DialogHeader>
          <ol className="flex w-full max-w-md flex-col gap-2" aria-live="polite" aria-busy="true">
            {decideChecklist.map((item) => (
              <li key={item.key} className="flex items-center gap-2 text-sm">
                <Badge
                  variant={item.kind === "pending" ? "secondary" : "default"}
                  className="size-6 shrink-0 justify-center rounded-full p-0"
                  aria-hidden="true"
                >
                  {item.kind === "pending" ? <Spinner /> : <CheckIcon />}
                </Badge>
                <span className={item.kind === "pending" ? "text-muted-foreground" : undefined}>
                  {item.label}
                </span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
      <main className="mx-auto max-w-[1540px] px-[4.5%] pt-6 pb-14">
        <form id="ask" onSubmit={onAsk}>
          <Label className="sr-only" htmlFor="question">
            Question
          </Label>
          <InputGroup>
            <InputGroupInput
              id="question"
              name="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which patterns dominate?"
              autoComplete="off"
            />
            <InputGroupAddon>
              <FlaskConicalIcon />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end">
              <InputGroupButton type="submit" variant="ghost">
                Ask <ArrowRightIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </form>
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
              <div id="runs" className="flex flex-col gap-2 pr-1">
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
                      {i === 0 || run.fixture ? (
                        <Badge variant="outline" className="mt-0.5 text-[10px]">
                          {i === 0 ? "Latest" : ""}
                          {run.fixture ? `${i === 0 ? " · " : ""}Report` : ""}
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
            {hasPath ? (
              <>
                {heading.crumbs ? (
                  <div className="mb-6">
                    <PathActionsBreadcrumb crumbs={heading.crumbs} onRevert={onBreadcrumbCrumb} />
                    {heading.description ? (
                      <p
                        id="description"
                        className="text-muted-foreground mt-2 text-xs leading-relaxed"
                      >
                        {heading.description}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {pathState && !overviewMode && !onTimeline ? (
                  <div className="mb-6 flex flex-wrap items-center gap-4 text-xs">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="compare"
                        checked={compare}
                        onCheckedChange={(checked) => patchTipDisplay({ faceted: checked })}
                        size="sm"
                      />
                      <Label htmlFor="compare">Compare runs</Label>
                    </div>
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
                ) : null}
                {visibleFollowups.length ? (
                  <div id="followups" className="mb-6 flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">
                      Follow-ups
                    </span>
                    {visibleFollowups.map((name) => {
                      const what = morphismWhat(name);
                      return (
                        <Tooltip key={name}>
                          <TooltipTrigger
                            render={
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  void applyFollowup(name);
                                }}
                              />
                            }
                          >
                            {morphismLabel(name)}
                          </TooltipTrigger>
                          {what ? <TooltipContent>{what}</TooltipContent> : null}
                        </Tooltip>
                      );
                    })}
                  </div>
                ) : null}
                {timelineRunId ? (
                  <TimelineScrubber
                    runId={timelineRunId}
                    chart={tipState.timelineChart}
                    onOpenPattern={(runId, nodeId) => {
                      const sel: SelectionContext = {
                        runId,
                        binKey: String(nodeId),
                        patternId: nodeId,
                      };
                      void applyFollowup("select_bin", sel)
                        .then(async (selected) => {
                          await applyFollowup("open_pattern_detail", sel, selected.plan);
                        })
                        .catch(() => {
                          /* follow-up failed */
                        });
                    }}
                  />
                ) : (
                  <RunCharts
                    view={view}
                    overview={stateIsOverview(pathState)}
                    facets={chartFacets}
                    overviewMetrics={chartOverview}
                    loading={chartsLoading}
                    error={chartsError}
                    emptyMessage={null}
                    onSelectBin={onSelectBin}
                    onSelectRun={onSelectRun}
                  />
                )}
                <p id="query-status" className="text-muted-foreground mt-3 text-xs">
                  {queryStatus}
                </p>
                <Collapsible defaultOpen={false} className="group mt-8">
                  <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                    <ChevronRightIcon className="transition-transform group-data-open:rotate-90" />
                    Inspect
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <ContractInspect view={view} followups={followups} />
                  </CollapsibleContent>
                </Collapsible>
              </>
            ) : (
              <Empty id="title" className="min-h-[40vh] border-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    {runs.length ? <MessageCircleQuestionIcon /> : <DatabaseIcon />}
                  </EmptyMedia>
                  <EmptyTitle>
                    {runs.length ? "Ask a question to compose a view" : "No readable runs"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {runs.length
                      ? "Type a question above, or start from a measure."
                      : "Produce an experiment run, then refresh."}
                  </EmptyDescription>
                </EmptyHeader>
                {visibleFollowups.length ? (
                  <div className="mb-4 flex flex-wrap justify-center gap-2">
                    {visibleFollowups.map((name) => (
                      <Button
                        key={name}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void applyFollowup(name);
                        }}
                      >
                        {morphismLabel(name)}
                      </Button>
                    ))}
                  </div>
                ) : null}
                {runs.length ? (
                  <div className="mt-2 flex max-w-lg flex-wrap justify-center gap-2">
                    {explorerStarterPresets.map((preset) => (
                      <Button
                        key={preset.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSession(
                            sessionFromPreset(
                              preset.id,
                              runs.map((r) => r.id),
                            ),
                          );
                          setViewTick((n) => n + 1);
                        }}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </Empty>
            )}
          </section>
        </section>
      </main>
      {detailOpen ? (
        <PatternDetail
          runId={detailOpen.runId}
          nodeId={detailOpen.nodeId}
          version={detailVersion}
          onClose={() => {
            void applyFollowup("close_pattern_detail");
          }}
          onOpenNeighbor={(runId, nodeId) => {
            const sel: SelectionContext = {
              runId,
              binKey: String(nodeId),
              patternId: nodeId,
            };
            void applyFollowup("select_bin", sel)
              .then(async (selected) => {
                await applyFollowup("open_pattern_detail", sel, selected.plan);
              })
              .catch(() => {
                /* follow-up failed */
              });
          }}
        />
      ) : null}
    </>
  );
}
