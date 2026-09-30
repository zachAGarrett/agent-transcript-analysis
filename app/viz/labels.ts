import type { PatternLabeler } from "./types";
import { defaultPatternLabeler } from "./types";

let activeLabeler: PatternLabeler = defaultPatternLabeler;

/** Configure the pattern labeler used by chart bin labeling (adapter injects fixtures). */
export function setPatternLabeler(labeler: PatternLabeler): void {
  activeLabeler = labeler;
}

export function patternDisplayLabel(bin: { id?: number; key: string; token?: string }): string {
  return activeLabeler(bin);
}
