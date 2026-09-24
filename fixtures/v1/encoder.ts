import {
  type Atom,
  buildCodebook,
  compactAtoms,
  type Encoder,
  type Encoding,
  encodeWithTaxonomy,
} from "../encoders";
import type { Message } from "./message";
import { knownAtoms, taxonomy } from "./taxonomy";

const codebook = buildCodebook(knownAtoms);

/** Map an atom onto a codebook entry, falling back to `<axis>:other` when needed. */
export function resolveAtom(atom: Atom): Atom {
  if (codebook.has(atom)) return atom;
  const colon = atom.indexOf(":");
  if (colon < 0) throw new Error(`Invalid atom ${atom}`);
  const fallback = `${atom.slice(0, colon)}:other`;
  if (!codebook.has(fallback)) {
    throw new Error(`No codebook entry for ${atom} or ${fallback}`);
  }
  return fallback;
}

export function encodeAtom(atom: Atom): string {
  const resolved = resolveAtom(atom);
  const symbol = codebook.get(resolved);
  if (symbol === undefined) throw new Error(`Missing code for ${resolved}`);
  return symbol;
}

export const codebookEntries: ReadonlyMap<string, string> = codebook;

/**
 * v1 deterministic encoder: classify each taxonomy axis in parallel,
 * then compact positional tags into one composite symbol at runtime.
 */
export const encoder: Encoder<Message> = {
  taxonomy,
  encodeAtom,
  compact(atoms) {
    return compactAtoms(
      atoms.map((atom) => (atom === null ? null : resolveAtom(atom))),
      encodeAtom,
    );
  },
  async encode(message: Message): Promise<Encoding> {
    const raw = await encodeWithTaxonomy(message, taxonomy);
    return {
      atoms: raw.atoms.map((atom) => (atom === null ? null : resolveAtom(atom))),
    };
  },
};
