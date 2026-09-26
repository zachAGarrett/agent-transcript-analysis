import { basename, join } from "node:path";
import { runJob } from "@/experiments/run-job";
import { experiment } from "@/experiments/session-span/v1/experiment";

const ROOT = join(import.meta.dir, "../../..");

async function main(): Promise<void> {
  const arg = process.argv[2];
  const path = arg ?? join(ROOT, "fixtures/v1/runs/2026-09-24T23-33-14Z");
  const glob = "*.csv";

  const names = path.endsWith(".csv")
    ? [basename(path)]
    : (await Array.fromAsync(new Bun.Glob(glob).scan({ cwd: path, onlyFiles: true }))).sort();
  const paths = path.endsWith(".csv") ? [path] : names.map((name) => join(path, name));

  await runJob(experiment, { paths, root: ROOT });
}

if (import.meta.main) {
  await main();
}
