import { type DecideResponse, proposePathRules, proposePathWithJev } from "./classify";
import { defaultRoot, RunStore } from "./data";
import page from "./index.html";
import { applyPath, enabledNames, parsePathPlan, type SelectionContext } from "./path-space";

const MAX_QUESTION = 512;

async function decideQuestion(question: string, catalogRuns: string[]): Promise<DecideResponse> {
  if (!process.env.AI_GATEWAY_API_KEY) return proposePathRules(question, catalogRuns);
  try {
    return await proposePathWithJev(question, catalogRuns);
  } catch {
    return proposePathRules(question, catalogRuns);
  }
}

const store = new RunStore(process.env.EXPLORER_RUNS ?? defaultRoot);
const port = Number(process.env.PORT ?? 8766);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  development: process.env.NODE_ENV !== "production",
  routes: { "/": page },
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(url.host))
      return new Response("Invalid host", { status: 403 });
    if (request.method !== "GET") return new Response("Read-only service", { status: 405 });
    try {
      let result: unknown;
      if (url.pathname === "/api/runs") result = await store.catalog();
      else if (url.pathname === "/api/decide") {
        const question = (url.searchParams.get("question") ?? "").trim();
        if (!question) throw new Error("Question is required.");
        if (question.length > MAX_QUESTION) throw new Error("Question too long.");
        const { runs } = await store.catalog();
        result = await decideQuestion(
          question,
          runs.map((run) => run.id),
        );
      } else if (url.pathname === "/api/view") {
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
        };
        const { runs } = await store.catalog();
        const { state } = parsePathPlan(
          session,
          runs.map((r) => r.id),
        );
        const next = applyPath(state, action, session.selection);
        if (!next.ok) throw new Error(next.error);
        const runsOut =
          action === "focus_run" && next.state.selectionRunId
            ? [next.state.selectionRunId]
            : session.runs;
        const enabledContext = next.state.hasSelection
          ? {
              runId: next.state.selectionRunId,
              binKey: next.state.selectionBinKey,
              patternId: next.state.selectionPatternId || undefined,
              lengthKey: next.state.selectionLengthKey || undefined,
            }
          : undefined;
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
  },
});
console.log(`Lattice explorer: ${server.url}`);
console.log(`Read-only runs: ${store.root}`);
