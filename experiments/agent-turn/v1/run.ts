import { basename, join } from "node:path";
import { experiment } from "@/experiments/agent-turn/v1/experiment";
import { runJob } from "@/experiments/run-job";

const ROOT = join(import.meta.dir, "../../..");

/** Thin entry: prefer `bun cli experiments agent-turn …`. */
async function main(): Promise<void> {
  const arg = process.argv[2];
  const path = arg
    ? arg.endsWith(".csv")
      ? arg
      : join(arg)
    : join(ROOT, "fixtures/v1/2026-09-24T23-33-14Z");
  const glob = "*.csv";

  const names = path.endsWith(".csv")
    ? [basename(path)]
    : (await Array.fromAsync(new Bun.Glob(glob).scan({ cwd: path, onlyFiles: true }))).sort();
  const paths = path.endsWith(".csv") ? [path] : names.map((name) => join(path, name));
  const dir = path.endsWith(".csv") ? join(path, "..") : path;
  const dirRel = dir.startsWith(ROOT) ? dir.slice(ROOT.length).replace(/^\//, "") : dir;

  await runJob(experiment, {
    paths,
    producer: {
      kind: "directory",
      dir: dirRel,
      glob: path.endsWith(".csv") ? basename(path) : glob,
      sample: { matched: names.length, selected: paths.length },
    },
    root: ROOT,
  });
}

if (import.meta.main) {
  await main();
}
