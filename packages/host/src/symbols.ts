/** One classified atom: `axis:value`. */
export type Atom = string;

/**
 * Slot for an axis that does not apply.
 * `-` is outside the base36 code alphabet, so compacted composites stay collision-safe.
 */
export const EMPTY_SYMBOL = "-.";

/**
 * Terminates each compacted sequence unit so concatenated lattice patterns stay
 * human-splittable (`unit|unit|`) without relying on fixed width alone.
 * Outside the base36 + empty alphabet.
 */
export const UNIT_DELIMITER = "|";

/** Strip a trailing unit delimiter before fragment parsing. */
export function stripUnitDelimiter(composite: string): string {
  return composite.endsWith(UNIT_DELIMITER)
    ? composite.slice(0, -UNIT_DELIMITER.length)
    : composite;
}

/** Split a composite on the trailing-dot delimiter into symbol fragments. */
export function splitComposite(composite: string): string[] {
  const body = stripUnitDelimiter(composite);
  const parts = body.match(/(?:-|[0-9a-z]+)\./g);
  if (!parts || parts.join("") !== body) {
    throw new Error(`Invalid composite ${composite}`);
  }
  return parts;
}

/** Lowercase unpadded base36 for a non-negative integer. */
export function toBase36(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`toBase36 expects a non-negative integer, got ${n}`);
  }
  return n.toString(36);
}

/**
 * Build a fixed codebook from sorted atom strings.
 * Each fragment is `code + "."` so variable-length codes cannot collide under compaction.
 */
export function buildCodebook(atoms: readonly string[]): Map<string, string> {
  const sorted = [...atoms].sort();
  const map = new Map<string, string>();
  for (let i = 0; i < sorted.length; i++) {
    const atom = sorted[i];
    if (atom === undefined) continue;
    map.set(atom, `${toBase36(i)}.`);
  }
  return map;
}
