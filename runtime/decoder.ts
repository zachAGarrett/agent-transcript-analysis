import {
  type DecodeResult,
  decodeIndexed,
  type ICompiledLattice,
  type ILattice,
  type LatticeDecodeOptions,
} from "@khoralabs/tkn";
import { atomicFallbackRate, multiSymbolCoverage } from "@/experiments/metrics";
import { DecodedContext, PREDICTION_TOP_K, predictNext, type RankedNext } from "./predictor";

export type NextPattern = RankedNext;

export type DecodeSnapshot = {
  symbols: readonly string[];
  result: DecodeResult;
  multiSymbolCoverage: number;
  atomicFallbackRate: number;
  /** Full decoded step count before any event-tail truncation. */
  decodedStepCount: number;
  /** Ranked next patterns from LM-scored predictor; else []. */
  next: NextPattern[];
};

export type LiveDecoderOptions = {
  decodeOptions?: LatticeDecodeOptions;
  /** Max ranked candidates to return (default PREDICTION_TOP_K). */
  topK?: number;
};

/**
 * Growing-prefix decoder against a refreshable compiled lattice snapshot.
 * Owns per-run decoded tip context for second-order prediction.
 */
export class LiveDecoder {
  private readonly lattice: ILattice;
  private readonly decodeOptions: LatticeDecodeOptions | undefined;
  private readonly topK: number;
  private compiled: ICompiledLattice | null = null;
  private readonly symbols: string[] = [];
  readonly context = new DecodedContext();

  constructor(lattice: ILattice, options?: LiveDecoderOptions) {
    this.lattice = lattice;
    this.decodeOptions = options?.decodeOptions;
    this.topK = options?.topK ?? PREDICTION_TOP_K;
  }

  /** Replace the compiled snapshot used for subsequent decodes/predictions. */
  refresh(compiled: ICompiledLattice): void {
    this.compiled = compiled;
  }

  /** Append one symbol, decode, forecast from current context, then observe the new tip. */
  pushSymbol(symbol: string): DecodeSnapshot {
    this.symbols.push(symbol);
    const snap = this.snapshot();
    if (snap.result.complete) this.context.observeTip(snap.result.tokens.at(-1) ?? null);
    return snap;
  }

  get prefix(): readonly string[] {
    return this.symbols;
  }

  /** Read-only forecast without appending a symbol or mutating context. */
  snapshot(): DecodeSnapshot {
    const symbols = [...this.symbols];
    const compiled = this.compiled ?? this.lattice.compile();
    this.compiled = compiled;
    const result = this.decodePrefix(symbols, compiled);
    const tip = result.complete ? (result.tokens.at(-1) ?? null) : null;
    const latestSymbol = symbols.at(-1) ?? null;
    const next =
      result.complete && tip
        ? predictNext(this.lattice, compiled, {
            decodedTip: tip,
            latestSymbol,
            context: this.context,
            topK: this.topK,
          })
        : [];
    return {
      symbols,
      result,
      multiSymbolCoverage: multiSymbolCoverage(result, symbols.length),
      atomicFallbackRate: atomicFallbackRate(result),
      decodedStepCount: result.steps.length,
      next,
    };
  }

  resetContext(): void {
    this.context.reset();
  }

  private decodePrefix(symbols: string[], compiled: ICompiledLattice): DecodeResult {
    if (symbols.length === 0) {
      return { tokens: [], steps: [], score: 0, complete: true };
    }
    const byStart = compiled.scanAtoms(symbols);
    return decodeIndexed(
      {
        length: symbols.length,
        matchCandidates: (offset) => byStart[offset] ?? [],
        fallbackCandidate: (offset) => {
          const atom = symbols[offset];
          return atom === undefined ? null : { pattern: atom, length: 1 };
        },
        emissionScore: (token) => compiled.emissionLogProb(token),
        transitionWeight: (from, to) => compiled.transitionLogProb(from, to),
      },
      this.decodeOptions,
    );
  }
}
