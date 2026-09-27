import {
  type FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PathPlan } from "./algebra";
import { chartsMarkup, contractsMarkup, isResidual, overviewMarkup } from "./charts";
import type { DecideResponse } from "./classify";
import type { Run, View } from "./data";
import { pathTitle, planNormalized } from "./interpret";
import { PatternDetail, runVersion } from "./PatternDetail";
import {
  enabledNames,
  type PathState,
  revertPathTo,
  type SelectionContext,
  visiblePathSteps,
} from "./path-space";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);

const VIEW_CHANGING = new Set([
  "re_rollup",
  "drill_length_patterns",
  "partition_by_length",
  "focus_run",
]);
const CLEAR_SELECTION = new Set(["clear_selection", "re_rollup", "drill_length_patterns"]);

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Query failed.");
  return data as T;
}

function isOverview(plan: PathPlan) {
  return plan.steps.some((s) => s.name === "load_run_scalars");
}

function selectionContextFromState(state: PathState): SelectionContext | undefined {
  if (!state.hasSelection) return undefined;
  return {
    runId: state.selectionRunId,
    binKey: state.selectionBinKey,
    patternId: state.selectionPatternId || undefined,
    lengthKey: state.selectionLengthKey || undefined,
  };
}

function samePlan(a: PathPlan | null, b: PathPlan): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b);
}

type DetailTarget = { runId: string; nodeId: number };

export function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selected, setSelected] = useState("");
  const [currentPlan, setCurrentPlan] = useState<PathPlan | null>(null);
  const [pathState, setPathState] = useState<PathState | null>(null);
  const [followups, setFollowups] = useState<string[]>([]);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [notice, setNotice] = useState("");
  const [question, setQuestion] = useState("");
  const [compare, setCompare] = useState(false);
  const [limit, setLimit] = useState(10);
  const [normalized, setNormalized] = useState(false);
  const [chartsHtml, setChartsHtml] = useState("");
  const [queryStatus, setQueryStatus] = useState("");
  const [contractHtml, setContractHtml] = useState("Waiting for query.");
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [viewTick, setViewTick] = useState(0);
  const generation = useRef(0);
  const pathStateRef = useRef(pathState);
  const followupsRef = useRef(followups);
  const currentPlanRef = useRef(currentPlan);
  const selectionRef = useRef(selection);
  const chartsRef = useRef<HTMLDivElement>(null);
  const contractRef = useRef<HTMLDivElement>(null);
  pathStateRef.current = pathState;
  followupsRef.current = followups;
  currentPlanRef.current = currentPlan;
  selectionRef.current = selection;

  const overviewMode = currentPlan ? isOverview(currentPlan) : false;

  const loadRuns = useCallback(async () => {
    setNotice("");
    try {
      const result = await api<{ runs: Run[]; errors: { id: string; error: string }[] }>(
        "/api/runs",
      );
      setRuns(result.runs);
      setSelected((prev) =>
        result.runs.some((run) => run.id === prev) ? prev : (result.runs[0]?.id ?? ""),
      );
      if (!result.runs.length) setChartsHtml("Produce an experiment run, then refresh.");
      if (result.errors.length)
        setNotice(result.errors.map((item) => `${item.id}: ${item.error}`).join(" "));
      if (currentPlanRef.current) setViewTick((n) => n + 1);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not list runs.");
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (chartsRef.current) chartsRef.current.innerHTML = chartsHtml;
  }, [chartsHtml]);

  useEffect(() => {
    if (contractRef.current) contractRef.current.innerHTML = contractHtml;
  }, [contractHtml]);

  const planFromControls = useCallback(
    (base: PathPlan): PathPlan => {
      let steps = base.steps.map((s) =>
        s.name.startsWith("top_k_") ? { name: `top_k_${limit}`, params: { limit } } : { ...s },
      );
      const overview = isOverview(base);
      const hasNorm = steps.some((s) => s.name === "normalize");
      if (normalized && !hasNorm && !overview) {
        const i = steps.findIndex((s) => s.name === "commit");
        steps.splice(i >= 0 ? i : steps.length, 0, { name: "normalize" });
      }
      if (!normalized && hasNorm) steps = steps.filter((s) => s.name !== "normalize");
      const wantCompare = compare || overview;
      const hasFacet = steps.some((s) => s.name === "facet_runs");
      if (wantCompare && !hasFacet && !overview) {
        const i = steps.findIndex((s) => s.name === "commit");
        steps.splice(i >= 0 ? i : steps.length, 0, { name: "facet_runs" });
      }
      if (!wantCompare && hasFacet) steps = steps.filter((s) => s.name !== "facet_runs");
      return {
        steps,
        runs: wantCompare
          ? runs.slice(0, 12).map((r) => r.id)
          : ([selected || runs[0]?.id].filter(Boolean) as string[]),
      };
    },
    [compare, limit, normalized, runs, selected],
  );

  useEffect(() => {
    if (!runs.length || !currentPlan) return;
    void viewTick;
    const request = ++generation.current;
    setChartsHtml('<div class="loading">Querying…</div>');
    setQueryStatus("");
    setContractHtml("Waiting for query.");
    const started = performance.now();
    const plan = planFromControls(currentPlan);
    const state = pathStateRef.current;
    void api<View>(`/api/view?plan=${encodeURIComponent(JSON.stringify(plan))}`)
      .then((next) => {
        if (request !== generation.current) return;
        setView(next);
        setCurrentPlan((prev) => (samePlan(prev, next.plan) ? prev : next.plan));
        const norm = planNormalized(next.plan);
        const markup = isOverview(next.plan)
          ? overviewMarkup(next, selected)
          : chartsMarkup(next, norm, selectionRef.current, state);
        setChartsHtml(markup);
        setQueryStatus(
          `${number(performance.now() - started)} ms · ${next.facets.length} run${next.facets.length === 1 ? "" : "s"} · ${next.cacheHit ? "cache" : "SQLite"}`,
        );
        setContractHtml(contractsMarkup(next, followupsRef.current));
      })
      .catch((error: unknown) => {
        if (request !== generation.current) return;
        setChartsHtml('<div class="loading">This view could not be loaded.</div>');
        setNotice(error instanceof Error ? error.message : "Query failed.");
      });
  }, [currentPlan, runs, selected, viewTick, planFromControls]);

  // Re-highlight chart selection without refetching SQLite.
  useEffect(() => {
    if (!view || isOverview(view.plan)) return;
    const norm = planNormalized(view.plan);
    setChartsHtml(chartsMarkup(view, norm, selection, pathState));
    setContractHtml(contractsMarkup(view, followups));
  }, [selection, pathState, followups, view]);

  const applyFollowup = useCallback(
    async (action: string, nextSelection?: SelectionContext | null) => {
      if (!currentPlan) throw new Error("No current path.");
      const sel = nextSelection !== undefined ? nextSelection : selection;
      if (nextSelection !== undefined) setSelection(nextSelection);
      const result = await api<{
        plan: PathPlan;
        state: PathState;
        enabled: string[];
      }>(
        `/api/followup?action=${encodeURIComponent(action)}&session=${encodeURIComponent(JSON.stringify({ ...currentPlan, selection: sel }))}`,
      );
      setCurrentPlan(result.plan);
      setPathState(result.state);
      setFollowups(result.enabled);
      if (action === "focus_run" && result.plan.runs[0]) {
        setSelected(result.plan.runs[0]);
        setCompare(false);
      }
      if (CLEAR_SELECTION.has(action)) setSelection(null);
      else if (result.state.hasSelection) {
        setSelection({
          runId: result.state.selectionRunId,
          binKey: result.state.selectionBinKey,
          patternId: result.state.selectionPatternId || undefined,
          lengthKey: result.state.selectionLengthKey || undefined,
        });
      }
      if (result.state.detailRequested && result.state.selectionPatternId > 0) {
        setDetail({
          runId: result.state.selectionRunId,
          nodeId: result.state.selectionPatternId,
        });
      }
      setNotice(`Follow-up · ${action}`);
      if (VIEW_CHANGING.has(action)) {
        setViewTick((n) => n + 1);
      }
    },
    [currentPlan, selection],
  );

  const revertToPathIndex = useCallback(
    (throughIndex: number) => {
      if (!currentPlan) return;
      try {
        const catalog = runs.map((run) => run.id);
        const { plan, state } = revertPathTo(
          currentPlan.steps,
          throughIndex,
          catalog,
          currentPlan.runs,
        );
        setCurrentPlan(plan);
        setPathState(state);
        const ctx = selectionContextFromState(state);
        setSelection(ctx ?? null);
        setFollowups(enabledNames(state, ctx));
        setNotice(
          `Reverted · ${visiblePathSteps(plan.steps)
            .map((v) => v.step.name)
            .join(" → ")}`,
        );
        setViewTick((n) => n + 1);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Revert failed.");
      }
    },
    [currentPlan, runs],
  );

  const onAsk = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fromForm = String(new FormData(form).get("question") ?? "").trim();
    const q = fromForm || question.trim();
    if (!q) return;
    setNotice("Composing path…");
    let decision: DecideResponse;
    try {
      decision = await api<DecideResponse>(`/api/decide?question=${encodeURIComponent(q)}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Path proposal failed.");
      return;
    }
    if (!decision.plan) {
      setNotice(
        decision.source === "rules"
          ? "No forced path — set AI_GATEWAY_API_KEY for Jev, or use follow-ups on a committed view."
          : "Could not compose a legal path for that question.",
      );
      return;
    }
    setCurrentPlan(decision.plan);
    setPathState(decision.state);
    setFollowups(decision.enabledFollowups ?? []);
    setSelection(null);
    setCompare(decision.plan.runs.length > 1 && !isOverview(decision.plan));
    if (decision.plan.runs.length === 1) setSelected(decision.plan.runs[0] ?? selected);
    setNotice(`Path via ${decision.source} · ${decision.steps.map((s) => s.label).join(" → ")}`);
  };

  const onChartsClick = (event: MouseEvent) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-bin],[data-run]")
        : null;
    if (!target || !currentPlan) return;
    if (target.dataset.bin && target.classList.contains("chart-row")) {
      const binKey = target.dataset.bin;
      if (isResidual(binKey)) return;
      const lengthKey =
        target.dataset.length ||
        (pathState?.grain === "length" ? binKey : undefined) ||
        (binKey.includes(":") ? binKey.split(":")[0] : undefined);
      const next: SelectionContext = {
        runId: target.dataset.run ?? "",
        binKey,
        patternId: target.dataset.node ? Number(target.dataset.node) : undefined,
        lengthKey,
      };
      void applyFollowup("select_bin", next)
        .then(() => {
          if (next.patternId && next.patternId > 0)
            setDetail({ runId: next.runId, nodeId: next.patternId });
        })
        .catch((error) => {
          setNotice(error instanceof Error ? error.message : "Select failed.");
        });
      return;
    }
    if (target.dataset.run && !target.dataset.bin && !target.dataset.node) {
      setSelected(target.dataset.run);
      setCompare(false);
      setNotice("");
    }
  };

  const heading = useMemo(() => {
    if (!currentPlan?.steps.length) {
      return {
        crumbs: null as { name: string; index: number }[] | null,
        description: "",
        emptyTitle: runs.length ? "Ask a question to compose a view" : "No readable runs",
      };
    }
    const meta = pathState ? pathTitle(pathState) : { description: "" };
    const visible = visiblePathSteps(currentPlan.steps);
    return {
      crumbs: visible.map(({ step, index }) => ({ name: step.name, index })),
      description: meta.description,
      emptyTitle: "Empty path",
    };
  }, [currentPlan, pathState, runs.length]);

  const visibleFollowups = followups.filter((name) => name !== "select_bin" && name !== "commit");
  const detailVersion = detail ? runVersion(runs, detail.runId) : "";

  return (
    <>
      <header>
        <a className="brand" href="/">
          Run explorer
        </a>
        <span className="local">Local · read only</span>
      </header>
      <main>
        <form id="ask" onSubmit={onAsk}>
          <label className="sr-only" htmlFor="question">
            Question
          </label>
          <input
            id="question"
            name="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Which patterns dominate?"
            autoComplete="off"
          />
          <button type="submit">Ask</button>
        </form>
        <div id="notice" role="status" aria-live="polite">
          {notice}
        </div>
        <section className="workspace">
          <aside className="sidebar">
            <div className="section-label">
              Runs
              <button
                id="refresh"
                type="button"
                title="Reload run databases"
                onClick={() => void loadRuns()}
              >
                Refresh
              </button>
            </div>
            <div id="runs">
              {runs.length ? (
                runs.map((run, i) => (
                  <button
                    key={run.id}
                    type="button"
                    className={`run ${run.id === selected ? "selected" : ""}`}
                    aria-pressed={run.id === selected}
                    onClick={() => {
                      setSelected(run.id);
                      setCompare(false);
                      setNotice("");
                    }}
                  >
                    <span className="run-date">
                      {run.id.slice(0, 10)}
                      <span className="run-time">{run.id.slice(11, 19).replaceAll("-", ":")}</span>
                    </span>
                    <small>
                      {number(run.nodes)} patterns · {number(run.mass)} stored counts
                    </small>
                    <span className="badge">
                      {i === 0 ? "Latest" : ""}
                      {run.fixture ? `${i === 0 ? " · " : ""}Report` : ""}
                    </span>
                  </button>
                ))
              ) : (
                <p className="facts">Reading databases…</p>
              )}
            </div>
          </aside>
          <section className="content">
            <div className="view-heading">
              <h2 id="title">
                {heading.crumbs?.length
                  ? heading.crumbs.map((crumb, i) => (
                      <span key={`${crumb.index}-${crumb.name}`}>
                        {i > 0 ? (
                          <span className="path-sep" aria-hidden="true">
                            →
                          </span>
                        ) : null}
                        <button
                          type="button"
                          className="path-crumb"
                          title={`Revert to ${crumb.name}`}
                          onClick={() => revertToPathIndex(crumb.index)}
                        >
                          {crumb.name}
                        </button>
                      </span>
                    ))
                  : heading.emptyTitle}
              </h2>
              <p id="description">{heading.description}</p>
            </div>
            <div className="controls">
              <label id="compare-control" hidden={overviewMode}>
                <input
                  id="compare"
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                />{" "}
                Compare runs
              </label>
              <label id="limit-control" hidden={overviewMode}>
                Show{" "}
                <select id="limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  <option value={5}>Top 5</option>
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                </select>
              </label>
              <label id="scale-control" hidden={overviewMode}>
                <input
                  id="normalized"
                  type="checkbox"
                  checked={normalized}
                  onChange={(e) => setNormalized(e.target.checked)}
                />{" "}
                Share of run total
              </label>
            </div>
            <div id="followups" className="followups">
              {visibleFollowups.length ? (
                <>
                  <span className="tiny">Follow-ups</span>{" "}
                  {visibleFollowups.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => {
                        void applyFollowup(name).catch((error) => {
                          setNotice(error instanceof Error ? error.message : "Follow-up failed.");
                        });
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: delegated SVG chart clicks */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard handled via chart-row focus targets in markup */}
            <div id="charts" ref={chartsRef} aria-live="polite" onClick={onChartsClick} />
            <p id="query-status" className="query-status">
              {queryStatus}
            </p>
            <details className="contract">
              <summary>Inspect</summary>
              <div id="contract" ref={contractRef} />
            </details>
          </section>
        </section>
      </main>
      {detail ? (
        <PatternDetail
          runId={detail.runId}
          nodeId={detail.nodeId}
          version={detailVersion}
          onClose={() => setDetail(null)}
          onOpenNeighbor={(runId, nodeId) => setDetail({ runId, nodeId })}
        />
      ) : null}
    </>
  );
}
