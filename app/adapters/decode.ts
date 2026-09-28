import type { PatternAtom, PatternStep } from "@workstream/lattice-viz";
import { splitComposite } from "../../fixtures/encoders";
import { decode as decodeV1 } from "../../fixtures/v1/decoder";
import { taxonomy as taxonomyV1 } from "../../fixtures/v1/taxonomy";
import { decode as decodeV2 } from "../../fixtures/v2/decoder";
import { taxonomy as taxonomyV2 } from "../../fixtures/v2/taxonomy";

export type { PatternAtom, PatternStep };

type Scheme = {
  axes: readonly string[];
  decode: (composite: string) => Array<string | null>;
};

const schemesByWidth = new Map<number, Scheme>([
  [taxonomyV2.length, { axes: taxonomyV2.map((entry) => entry.axis), decode: decodeV2 }],
  [taxonomyV1.length, { axes: taxonomyV1.map((entry) => entry.axis), decode: decodeV1 }],
]);

function atomValue(atom: string): string {
  const colon = atom.indexOf(":");
  return colon >= 0 ? atom.slice(colon + 1) : atom;
}

function atomAxis(atom: string): string | null {
  const colon = atom.indexOf(":");
  return colon > 0 ? atom.slice(0, colon) : null;
}

/** Prefer purpose, then intent, then tool, else first value. */
export function abbreviateAtoms(atoms: readonly PatternAtom[]): string {
  const byAxis = new Map(atoms.map((atom) => [atom.axis, atom.value]));
  return (
    byAxis.get("purpose") ??
    byAxis.get("intent") ??
    byAxis.get("tool") ??
    atoms[0]?.value ??
    "(empty)"
  );
}

function decodeUnit(unit: string): PatternStep | null {
  const composite = unit.endsWith("|") ? unit : `${unit}|`;
  try {
    const width = splitComposite(composite).length;
    const scheme = schemesByWidth.get(width);
    if (!scheme) return null;
    const raw = scheme.decode(composite);
    if (raw.length !== scheme.axes.length) return null;
    const atoms: PatternAtom[] = [];
    for (let i = 0; i < raw.length; i++) {
      const atom = raw[i];
      if (!atom) continue;
      const axis = scheme.axes[i] ?? atomAxis(atom);
      if (!axis) continue;
      atoms.push({ axis, value: atomValue(atom) });
    }
    return {
      atoms,
      brief: abbreviateAtoms(atoms),
      full: atoms.map((atom) => `${atom.axis}:${atom.value}`).join(" · ") || "(empty)",
    };
  } catch {
    return null;
  }
}

/** Structured steps for a lattice pattern token; null if codebook unknown. */
export function decodePatternSteps(token: string): PatternStep[] | null {
  const units = token.split("|").filter(Boolean);
  if (!units.length) return null;
  const steps: PatternStep[] = [];
  for (const unit of units.slice(0, 40)) {
    const step = decodeUnit(unit);
    if (!step) return null;
    steps.push(step);
  }
  return steps;
}

/** Full atom lines per unit (legacy shape for callers that only need strings). */
export function decodePatternUnits(token: string): string[] | null {
  const steps = decodePatternSteps(token);
  return steps?.map((step) => step.full) ?? null;
}

/**
 * Middle-truncate a step chain for compact labels.
 * 1–2 steps: full chain; 3+: first → … → last.
 */
export function formatPatternChain(steps: readonly string[], separator = " → "): string {
  if (!steps.length) return "";
  if (steps.length <= 2) return steps.join(separator);
  return `${steps[0]}${separator}…${separator}${steps[steps.length - 1]}`;
}

/** Intent/purpose/tool briefs for every step (no middle truncation). */
export function formatPatternBriefChain(token: string | undefined): string | null {
  if (!token) return null;
  const steps = decodePatternSteps(token);
  if (!steps?.length) return null;
  return steps.map((step) => step.brief).join(" → ");
}

/** Compact intent/purpose/tool chain for a pattern token (middle-truncated). */
export function abbreviatePattern(token: string | undefined): string | null {
  if (!token) return null;
  const steps = decodePatternSteps(token);
  if (!steps?.length) return null;
  return formatPatternChain(steps.map((step) => step.brief));
}

/** Chart / neighbor label: abbreviated chain, else Pattern #id. */
export function patternDisplayLabel(bin: { id?: number; key: string; token?: string }): string {
  return abbreviatePattern(bin.token) ?? `Pattern #${bin.id ?? bin.key}`;
}
