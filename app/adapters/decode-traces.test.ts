import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDecodeTraces, readDecodeSummary, readDecodeTrace } from "./decode-traces";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("decode-traces adapter", () => {
  test("lists and reads traces with path safety", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-traces-"));
    dirs.push(root);
    const run = "2026-01-01T00-00-00Z";
    const runDir = join(root, run);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(runDir);
    writeFileSync(join(runDir, "lattice.db"), "");
    writeFileSync(
      join(runDir, "decodes.jsonl"),
      `${JSON.stringify({
        id: "s1",
        sessionId: "s1",
        symbolCount: 2,
        result: {
          tokens: ["a|"],
          steps: [
            {
              token: "a|",
              start: 0,
              end: 1,
              emissionScore: -1,
              transitionScore: 0,
              cumulativeScore: -1,
            },
          ],
          score: -1,
          complete: true,
        },
        multiSymbolCoverage: 0,
        atomicFallbackRate: 1,
        meanSpan: 1,
        segmentsPerStep: 1,
        latencyMs: 0.1,
      })}\n`,
    );

    const listed = await listDecodeTraces(root, run);
    expect(listed.traces).toHaveLength(1);
    expect(listed.traces[0]?.id).toBe("s1");

    const detail = await readDecodeTrace(root, run, "s1", ["a|", "b|"]);
    expect(detail.aligned[0]?.sourceSymbols).toEqual(["a|"]);

    await expect(listDecodeTraces(root, "../escape")).rejects.toThrow(/Invalid run ID/);
  });

  test("reads decode-summary.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-summary-"));
    dirs.push(root);
    const run = "job1";
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(root, run));
    writeFileSync(join(root, run, "lattice.db"), "");
    writeFileSync(
      join(root, run, "decode-summary.json"),
      JSON.stringify({
        version: 1,
        metrics: {
          sequenceCount: 1,
          completeRate: 1,
          multiSymbolCoverage: 0,
          atomicFallbackRate: 1,
          meanSpan: 1,
          meanSegmentsPerStep: 1,
          meanScore: -1,
          meanLatencyMs: 1,
          vocabularySize: 2,
        },
        spanLengthBins: [{ key: "1", label: "1", value: 3 }],
        fallbackRate: 1,
        meanSurprisal: 1,
      }),
    );
    const summary = await readDecodeSummary(root, run);
    expect(summary?.spanLengthBins[0]?.value).toBe(3);
  });
});
