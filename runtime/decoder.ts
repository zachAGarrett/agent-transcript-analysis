import {
  type DecodeResult,
  decodeIndexed,
  type ICompiledLattice,
  type ILattice,
  type LatticeDecodeOptions,
} from "@khoralabs/tkn";
import { atomicFallbackRate, multiSymbolCoverage } from "@/experiments/metrics";

export type NextPattern = {
  pattern: string;
  weight: number;
  prob: number;
};

export type DecodeSnapshot = {
  symbols: readonly string[];
  result: DecodeResult;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  /** Ranked getNext from last decoded token when decode completed; else []. */
  next: NextPattern[];
};

export type LiveDecoderOptions = {
  decodeOptions?: LatticeDecodeOptions;
  /** Max getNext candidates to return (default 10). */
  topK?: number;
};

/**
 * Growing-prefix decoder against a refreshable compiled lattice snapshot.
 * Re-decodes the full prefix each push (same strategy as prefix eval).
 */
export class LiveDecoder {
  private readonly lattice: ILattice;
  private readonly decodeOptions: LatticeDecodeOptions | undefined;
  private readonly topK: number;
  private compiled: ICompiledLattice | null = null;
  private readonly symbols: string[] = [];

  constructor(lattice: ILattice, options?: LiveDecoderOptions) {
    this.lattice = lattice;
    this.decodeOptions = options?.decodeOptions;
    this.topK = options?.topK ?? 10;
  }

  /** Replace the compiled snapshot used for subsequent decodes. */
  refresh(compiled: ICompiledLattice): void {
    this.compiled = compiled;
  }

  /** Append one symbol, decode the full prefix, return a snapshot. */
  pushSymbol(symbol: string): DecodeSnapshot {
    this.symbols.push(symbol);
    return this.snapshot();
  }

  get prefix(): readonly string[] {
    return this.symbols;
  }

  snapshot(): DecodeSnapshot {
    const symbols = [...this.symbols];
    const result = this.decodePrefix(symbols);
    const next = this.rankNext(result);
    return {
      symbols,
      result,
      multiSymbolCoverage: multiSymbolCoverage(result, symbols.length),
      atomicFallbackRate: atomicFallbackRate(result),
      next,
    };
  }

  private decodePrefix(symbols: string[]): DecodeResult {
    if (symbols.length === 0) {
      return { tokens: [], steps: [], score: 0, complete: true };
    }
    const snapshot = this.compiled ?? this.lattice.compile();
    const byStart = snapshot.scanAtoms(symbols);
    return decodeIndexed(
      {
        length: symbols.length,
        matchCandidates: (offset) => byStart[offset] ?? [],
        fallbackCandidate: (offset) => {
          const atom = symbols[offset];
          return atom === undefined ? null : { pattern: atom, length: 1 };
        },
        emissionScore: (token) => snapshot.emissionLogProb(token),
        transitionWeight: (from, to) => snapshot.transitionLogProb(from, to),
      },
      this.decodeOptions,
    );
  }

  private rankNext(result: DecodeResult): NextPattern[] {
    if (!result.complete || result.tokens.length === 0) return [];
    const lastToken = result.tokens.at(-1);
    if (!lastToken) return [];
    const edges = this.lattice.getNext(lastToken);
    const total = edges.reduce((s, e) => s + e.weight, 0);
    return [...edges]
      .sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to))
      .slice(0, this.topK)
      .map((e) => ({
        pattern: e.to,
        weight: e.weight,
        prob: total > 0 ? e.weight / total : 0,
      }));
  }
}
