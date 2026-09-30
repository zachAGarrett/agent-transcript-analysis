import { Morphism } from "./ids";
import type { PathStep } from "./types";

/** Named preset paths (macros for fixed explorer charts — not interactive composition). */
export const presetPaths: Record<string, PathStep[]> = {
  overview: [{ name: Morphism.loadRunScalars }, { name: Morphism.commit }],
  patterns: [
    { name: Morphism.loadPatternMass },
    { name: Morphism.topK10 },
    { name: Morphism.commit },
  ],
  vocabulary: [
    { name: Morphism.loadPatternVocab },
    { name: Morphism.topK10 },
    { name: Morphism.commit },
  ],
  lengths: [
    { name: Morphism.loadPatternMass },
    { name: Morphism.rollupLength },
    { name: Morphism.commit },
  ],
  connectivity: [
    { name: Morphism.loadEdgeWeight },
    { name: Morphism.topK10 },
    { name: Morphism.commit },
  ],
  hubs: [{ name: Morphism.loadHub }, { name: Morphism.topK10 }, { name: Morphism.commit }],
  inflows: [{ name: Morphism.loadInDegree }, { name: Morphism.topK10 }, { name: Morphism.commit }],
  "lengths-by-edge": [
    { name: Morphism.loadEdgeWeight },
    { name: Morphism.rollupLength },
    { name: Morphism.commit },
  ],
  "lengths-by-in": [
    { name: Morphism.loadInDegree },
    { name: Morphism.rollupLength },
    { name: Morphism.commit },
  ],
  "lengths-by-hub": [
    { name: Morphism.loadHub },
    { name: Morphism.rollupLength },
    { name: Morphism.commit },
  ],
  "patterns-by-length": [
    { name: Morphism.loadPatternMass },
    { name: Morphism.partitionByLength },
    { name: Morphism.commit },
  ],
  "decode-spans": [{ name: Morphism.loadDecodeSpans }, { name: Morphism.commit }],
  "decode-fallback": [
    { name: Morphism.loadDecodeFallback },
    { name: Morphism.topK10 },
    { name: Morphism.commit },
  ],
};

/** Legacy starter chip list — explorer uses CATEGORY_VIEWS in app/views.ts instead. */
export const explorerStarterPresets: { id: keyof typeof presetPaths; label: string }[] = [
  { id: "patterns", label: "Mass" },
  { id: "vocabulary", label: "Vocabulary" },
  { id: "connectivity", label: "Outgoing" },
  { id: "hubs", label: "Hubs" },
  { id: "inflows", label: "Incoming" },
  { id: "lengths", label: "Lengths" },
  { id: "lengths-by-edge", label: "Lengths × edge" },
  { id: "lengths-by-hub", label: "Lengths × hub" },
  { id: "decode-spans", label: "Decode spans" },
  { id: "decode-fallback", label: "Decode fallback" },
];
