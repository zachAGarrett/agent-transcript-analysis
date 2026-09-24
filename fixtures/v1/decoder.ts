import { type Atom, type Decoder, EMPTY_SYMBOL, splitComposite } from "../encoders";
import { codebookEntries } from "./encoder";
import { taxonomy } from "./taxonomy";

const bySymbol = new Map<string, Atom>();
for (const [atom, symbol] of codebookEntries) {
  bySymbol.set(symbol, atom);
}

export function decodeAtom(symbol: string): Atom | null {
  const code = symbol.endsWith(".") ? symbol : `${symbol}.`;
  if (code === EMPTY_SYMBOL) return null;
  const atom = bySymbol.get(code);
  if (atom === undefined) throw new Error(`Unknown symbol ${symbol}`);
  return atom;
}

/**
 * Expand a v1 composite into positional atoms (taxonomy axis order).
 */
export function decode(composite: string): Array<Atom | null> {
  const parts = splitComposite(composite);
  if (parts.length !== taxonomy.length) {
    throw new Error(`Composite width ${parts.length} !== taxonomy width ${taxonomy.length}`);
  }
  return parts.map(decodeAtom);
}

export const decoder: Decoder = {
  decode,
  decodeAtom,
};
