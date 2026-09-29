import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CsvProducer } from "./csv-producer";
import { runJob } from "./run-job";
import type { ExperimentDefinition } from "./types";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeMiniFixtures(root: string): string[] {
  const jobDir = join(root, "fixtures", "v1", "runs", "job");
  mkdirSync(jobDir, { recursive: true });
  const header = "who,intent,kind,tool,sh,end";
  const paths: string[] = [];
  for (let i = 0; i < 4; i++) {
    const file = join(jobDir, `s${i}.csv`);
    writeFileSync(
      file,
      [header, "user,fix,,,,,", "agent,,tool,Read,,", "agent,,tool,Grep,,", "agent,,text,,,"].join(
        "\n",
      ),
    );
    paths.push(file);
  }
  return paths;
}

describe("runJob held-out harness", () => {
  test("writes report, decodes, and summary with session holdout", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-runjob-"));
    dirs.push(root);
    mkdirSync(join(root, "experiments", "session-span", "v1"), { recursive: true });
    // Minimal encoder scheme: copy from repo fixtures via dynamic import paths.
    // Use real v1 modules from workspace by pointing root at repo for scheme load.
    const repoRoot = join(import.meta.dir, "..");
    const paths = writeMiniFixtures(root);

    const definition: ExperimentDefinition = {
      name: "session-span",
      version: "v1",
      createProducer: (opts) =>
        new CsvProducer({
          paths: opts.paths,
          fixtureVersion: opts.fixtureVersion,
          root: repoRoot,
        }),
    };

    const result = await runJob(definition, {
      paths,
      fixtureVersion: "v1",
      root,
      holdoutPct: 25,
      seed: 1,
      fixtureJobId: "job",
    });

    expect(result.trainCount).toBeGreaterThan(0);
    expect(result.heldOutCount).toBeGreaterThan(0);
    expect(result.metrics).toBeDefined();
    expect(result.reportPath).toBeDefined();
    expect(result.decodesPath).toBeDefined();
    expect(result.decodeSummaryPath).toBeDefined();

    const report = JSON.parse(readFileSync(join(root, result.dir, "report.json"), "utf8"));
    expect(report.version).toBe(1);
    expect(report.job.heldOutCount).toBe(result.heldOutCount);
    expect(report.job.artifacts.decodesJsonl).toBeTruthy();

    const summary = JSON.parse(readFileSync(join(root, result.dir, "decode-summary.json"), "utf8"));
    expect(summary.version).toBe(1);
    expect(Array.isArray(summary.spanLengthBins)).toBe(true);
  });
});
