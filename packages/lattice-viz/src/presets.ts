import type { PathStep } from "./types";

/** Named preset paths (macros for docs/rules — not a separate plan type). */
export const presetPaths: Record<string, PathStep[]> = {
  overview: [{ name: "load_run_scalars" }, { name: "commit" }],
  patterns: [{ name: "load_pattern_mass" }, { name: "top_k_10" }, { name: "commit" }],
  vocabulary: [{ name: "load_pattern_vocab" }, { name: "top_k_10" }, { name: "commit" }],
  lengths: [{ name: "load_pattern_mass" }, { name: "rollup_length" }, { name: "commit" }],
  connectivity: [{ name: "load_edge_weight" }, { name: "top_k_10" }, { name: "commit" }],
  hubs: [{ name: "load_hub" }, { name: "top_k_10" }, { name: "commit" }],
  inflows: [{ name: "load_in_degree" }, { name: "top_k_10" }, { name: "commit" }],
  "lengths-by-edge": [{ name: "load_edge_weight" }, { name: "rollup_length" }, { name: "commit" }],
  "lengths-by-hub": [{ name: "load_hub" }, { name: "rollup_length" }, { name: "commit" }],
  "patterns-by-length": [
    { name: "load_pattern_mass" },
    { name: "partition_by_length" },
    { name: "commit" },
  ],
};

/** Starter chips shown in the explorer when no path is composed yet. */
export const explorerStarterPresets: { id: keyof typeof presetPaths; label: string }[] = [
  { id: "patterns", label: "Mass" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "connectivity", label: "Outgoing" },
  { id: "hubs", label: "Hubs" },
  { id: "inflows", label: "Incoming" },
  { id: "lengths", label: "Lengths" },
  { id: "lengths-by-edge", label: "Lengths × edge" },
  { id: "lengths-by-hub", label: "Lengths × hub" },
];
