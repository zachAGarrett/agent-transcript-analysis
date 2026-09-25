import { join } from "node:path";
import { runJob } from "@/experiments/run-job";
import { experiment } from "@/experiments/session-span/v1/experiment";

const ROOT = join(import.meta.dir, "../../..");

async function main(): Promise<void> {
  const arg = process.argv[2];
  const path = arg ?? join(ROOT, "fixtures/v1/2026-09-24T23-33-14Z");
  const paths = path.endsWith(".csv")
    ? [path]
    : (await Array.fromAsync(new Bun.Glob("*.csv").scan({ cwd: path, onlyFiles: true })))
        .sort()
        .map((name) => join(path, name));

  await runJob(experiment, { paths, taggingDir: path, root: ROOT });
}

if (import.meta.main) {
  await main();
}
