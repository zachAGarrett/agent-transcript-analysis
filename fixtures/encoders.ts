import { classifyEntry, type TaxonomyEntry } from "./taxonomies";

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

/** Encoded step: one entry per taxonomy axis, in scheme order. */
export type Encoding = {
  atoms: Array<Atom | null>;
};

/** Shared encoder contract. Concrete encoders may be deterministic or LLM-backed. */
export type Encoder<TMessage = unknown> = {
  readonly taxonomy: readonly TaxonomyEntry<TMessage>[];
  /** Map one atom to its compact `code.` fragment. */
  encodeAtom(atom: Atom): string;
  /** Classify a message into positional atoms. */
  encode(message: TMessage): Promise<Encoding>;
  /**
   * Flatten an ordered tag array into one canonical composite symbol.
   * Globally unique for that tag vector within the codebook vocabulary.
   */
  compact(atoms: ReadonlyArray<Atom | null>): string;
};

/** Shared decoder contract for a versioned encoder. */
export type Decoder = {
  /** Expand a composite symbol back into positional atoms. */
  decode(composite: string): Array<Atom | null>;
  /** Map one `code.` fragment (or EMPTY_SYMBOL) to an atom or null. */
  decodeAtom(symbol: string): Atom | null;
};

/**
 * Classify every taxonomy entry in parallel.
 * Every axis keeps its position; null means the axis does not apply.
 */
export async function encodeWithTaxonomy<TMessage>(
  message: TMessage,
  taxonomy: readonly TaxonomyEntry<TMessage>[],
): Promise<Encoding> {
  const results = await Promise.all(taxonomy.map((entry) => classifyEntry(message, entry)));
  return {
    atoms: results.map(({ axis, value }) => (value === null ? null : `${axis}:${value}`)),
  };
}

/** Compact positional atoms via an atom encoder into one delimited sequence unit. */
export function compactAtoms(
  atoms: ReadonlyArray<Atom | null>,
  encodeAtom: (atom: Atom) => string,
): string {
  return `${atoms.map((atom) => (atom === null ? EMPTY_SYMBOL : encodeAtom(atom))).join("")}${UNIT_DELIMITER}`;
}

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
