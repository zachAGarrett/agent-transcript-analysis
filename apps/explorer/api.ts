/**
 * Server-only API handlers (Bun SQLite). Must not be statically imported from
 * the HTML entry module — Bun's browser bundler would then see bun:sqlite.
 */
import "./adapters";
import { defaultRoot, RunStore } from "./adapters";
import { parseChartQuery } from "./viz/chart-query";

const store = new RunStore(process.env.EXPLORER_RUNS ?? defaultRoot);

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    let result: unknown;
    if (url.pathname === "/api/runs") result = await store.catalog();
    else if (url.pathname === "/api/view") {
      const input = url.searchParams.get("query") ?? url.searchParams.get("plan") ?? "";
      if (input.length > 8192) throw new Error("Query too large.");
      const { runs } = await store.catalog();
      const chartQuery = parseChartQuery(
        JSON.parse(input),
        runs.map((r) => r.id),
      );
      result = await store.query(chartQuery);
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
