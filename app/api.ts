/**
 * Server-only API handlers (Bun SQLite). Must not be statically imported from
 * the HTML entry module — Bun's browser bundler would then see bun:sqlite.
 */
import "./adapters";
import {
  applyPath,
  enabledNames,
  initialPathState,
  parsePathPlan,
  planRunsForState,
  restoreSessionTip,
  type SelectionContext,
  selectionContextFromState,
  Tip,
} from "@workstream/lattice-viz";
import type { DecideResponse, DecideStep } from "./adapters";
import { defaultRoot, proposePathRules, proposePathWithJev, RunStore } from "./adapters";

const MAX_QUESTION = 512;

export type DecideStreamEvent =
  | { type: "step"; step: DecideStep }
  | { type: "done"; result: DecideResponse }
  | { type: "error"; error: string };

async function decideQuestion(
  question: string,
  catalogRuns: string[],
  runHasEvents: boolean,
  onStep?: (step: DecideStep) => void | Promise<void>,
): Promise<DecideResponse> {
  const hooks = onStep ? { onStep } : undefined;
  if (!process.env.AI_GATEWAY_API_KEY) {
    return proposePathRules(question, catalogRuns, hooks, runHasEvents);
  }
  try {
    return await proposePathWithJev(question, catalogRuns, hooks, runHasEvents);
  } catch {
    return proposePathRules(question, catalogRuns, hooks, runHasEvents);
  }
}

const store = new RunStore(process.env.EXPLORER_RUNS ?? defaultRoot);

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/decide") {
    const question = (url.searchParams.get("question") ?? "").trim();
    if (!question || question.length > MAX_QUESTION) {
      return Response.json(
        { error: !question ? "question is required." : "Question too long." },
        { status: 400 },
      );
    }
    const { runs } = await store.catalog();
    const selectedRunId = url.searchParams.get("run") ?? "";
    const selected = runs.find((r) => r.id === selectedRunId) ?? runs[0];
    const runHasEvents = Boolean(selected?.hasEvents);
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const write = async (event: DecideStreamEvent) => {
      await writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
    };
    void (async () => {
      try {
        const result = await decideQuestion(
          question,
          runs.map((r) => r.id),
          runHasEvents,
          async (step) => {
            await write({ type: "step", step });
          },
        );
        await write({ type: "done", result });
      } catch (error) {
        await write({
          type: "error",
          error: error instanceof Error ? error.message : "Path proposal failed.",
        });
      } finally {
        await writer.close();
      }
    })();
    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  try {
    let result: unknown;
    if (url.pathname === "/api/runs") result = await store.catalog();
    else if (url.pathname === "/api/view") {
      const input = url.searchParams.get("plan") ?? "";
      if (input.length > 8192) throw new Error("Plan too large.");
      const { runs } = await store.catalog();
      const { plan } = parsePathPlan(
        JSON.parse(input),
        runs.map((r) => r.id),
      );
      result = await store.view(plan);
    } else if (url.pathname === "/api/followup") {
      const input = url.searchParams.get("session") ?? "";
      const action = url.searchParams.get("action") ?? "";
      if (!action) throw new Error("action is required.");
      const session = JSON.parse(input) as {
        steps: { name: string; params?: Record<string, unknown> }[];
        runs: string[];
        selection?: SelectionContext;
        detailRequested?: boolean;
        timelineRequested?: boolean;
        timelineChart?: "graph" | "length" | "accuracy";
        tip?: string;
        runHasEvents?: boolean;
      };
      const { runs } = await store.catalog();
      const catalogIds = runs.map((r) => r.id);
      const scopeRunId = session.runs[0] ?? session.selection?.runId ?? catalogIds[0] ?? "";
      const runHasEvents =
        typeof session.runHasEvents === "boolean"
          ? session.runHasEvents
          : Boolean(runs.find((r) => r.id === scopeRunId)?.hasEvents);
      const constructed =
        session.steps.length === 0
          ? { ...initialPathState, runHasEvents }
          : { ...parsePathPlan(session, catalogIds).state, runHasEvents };
      const state = restoreSessionTip(
        constructed,
        session.selection,
        session.detailRequested,
        session.timelineRequested,
        session.timelineChart,
        session.tip === Tip.query || session.tip === Tip.timeline ? session.tip : undefined,
        runHasEvents,
      );
      const next = applyPath(state, action, session.selection);
      if (!next.ok) throw new Error(next.error);
      const baseRuns = session.runs.length ? session.runs : catalogIds.slice(0, 1);
      const runsOut =
        next.state.steps.length === 0 ? baseRuns : planRunsForState(next.state, baseRuns);
      const enabledContext = selectionContextFromState(next.state);
      result = {
        state: next.state,
        enabled: enabledNames(next.state, enabledContext),
        plan: { steps: next.state.steps, runs: runsOut },
      };
    } else if (url.pathname === "/api/pattern") {
      const node = Number(url.searchParams.get("node"));
      if (!Number.isSafeInteger(node) || node < 1) throw new Error("Invalid pattern ID.");
      result = store.detail(
        url.searchParams.get("run") ?? "",
        node,
        url.searchParams.get("version") ?? "",
      );
    } else if (url.pathname === "/api/pattern-id") {
      const token = url.searchParams.get("token") ?? "";
      result = {
        id: store.patternIdByToken(url.searchParams.get("run") ?? "", token),
      };
    } else if (url.pathname === "/api/decode-traces") {
      const { listDecodeTraces } = await import("./adapters/decode-traces");
      result = await listDecodeTraces(store.root, url.searchParams.get("run") ?? "");
    } else if (url.pathname === "/api/decode-trace") {
      const { readDecodeTrace } = await import("./adapters/decode-traces");
      const symbolsRaw = url.searchParams.get("symbols");
      let sourceSymbols: string[] | undefined;
      if (symbolsRaw) {
        const parsed: unknown = JSON.parse(symbolsRaw);
        if (!Array.isArray(parsed) || !parsed.every((s): s is string => typeof s === "string")) {
          throw new Error("symbols must be a JSON array of strings.");
        }
        sourceSymbols = parsed;
      }
      result = await readDecodeTrace(
        store.root,
        url.searchParams.get("run") ?? "",
        url.searchParams.get("sequence") ?? "",
        sourceSymbols,
      );
    } else if (url.pathname === "/api/decode-summary") {
      const { readDecodeSummary } = await import("./adapters/decode-traces");
      const summary = await readDecodeSummary(store.root, url.searchParams.get("run") ?? "");
      if (!summary) throw new Error("No decode-summary.json for this run.");
      result = summary;
    } else if (url.pathname === "/api/runtime-timeline") {
      const { readRuntimeTimeline } = await import("./adapters/runtime-timeline");
      result = await readRuntimeTimeline(store.root, url.searchParams.get("run") ?? "");
    } else return new Response("Not found", { status: 404 });
    return Response.json(result, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Query failed." },
      { status: 400 },
    );
  }
}
