import type { PathStep } from "./types";

/** Named preset paths (macros for docs/rules — not a separate plan type). */
export const presetPaths: Record<string, PathStep[]> = {
  overview: [{ name: "load_run_scalars" }, { name: "commit" }],
  patterns: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
  lengths: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
  connectivity: [{ name: "load_edge_weight" }, { name: "top_k_10" }, { name: "commit" }],
  "patterns-by-length": [
    { name: "load_pattern_mass" },
    { name: "partition_by_length" },
    { name: "commit" },
  ],
};
