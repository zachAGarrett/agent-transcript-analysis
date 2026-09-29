import {
  createFeedState,
  createLZSequencer,
  type DecodeResult,
  decodeIndexed,
  feedInputStream,
  type ICompiledLattice,
  type ILattice,
  type LatticeDecodeOptions,
  type LmCompileOptions,
  type SequencerInput,
  Unbounded,
} from "@khoralabs/tkn";
import type { Producer, Sequence } from "./producers";

async function* symbolSource(symbols: string[]): AsyncGenerator<SequencerInput> {
  for (const symbol of symbols) yield symbol;
}

export type DecodeCompileOptions = LmCompileOptions;

/**
 * Experiment pipeline: ingest and decode sequences of compacted composites.
 * Does not open files — consumes a Producer stream.
 */
export class ExperimentPipeline {
  private readonly dictionary = new Unbounded();
  private readonly sequencer = createLZSequencer({
    cacheOptions: this.dictionary,
    historyOptions: { bounded: false },
  });
  private readonly feedState = createFeedState();

  constructor(readonly lattice: ILattice) {}

  /** Ingest one sequence; ends the sequencer sequence and clears the lattice transition cursor. */
  async processOne(sequence: Sequence): Promise<void> {
    if (sequence.symbols.length === 0) return;
    await feedInputStream(
      this.lattice,
      this.sequencer,
      symbolSource(sequence.symbols),
      this.feedState,
      1000,
    );
    await this.sequencer.endSequence();
    this.feedState.previousKey = null;
  }

  async *feed(producer: Producer): AsyncGenerator<Sequence> {
    for await (const sequence of producer.sequences()) {
      await this.processOne(sequence);
      yield sequence;
    }
  }

  /** Compile once per evaluation configuration (default smoothing may use lattice cache). */
  compile(options?: DecodeCompileOptions): ICompiledLattice {
    return this.lattice.compile(options);
  }

  /**
   * Segment a symbol sequence with Viterbi or beam over atom indices.
   * Spans are symbol offsets, not characters.
   */
  decode(
    sequence: Sequence,
    options?: LatticeDecodeOptions,
    compiled?: ICompiledLattice,
  ): DecodeResult {
    const symbols = sequence.symbols;
    if (symbols.length === 0) {
      return { tokens: [], steps: [], score: 0, complete: true };
    }

    const snapshot = compiled ?? this.compile();
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
      options,
    );
  }

  /** Token strings only (incomplete paths return []). */
  decodeTokens(
    sequence: Sequence,
    options?: LatticeDecodeOptions,
    compiled?: ICompiledLattice,
  ): string[] {
    const result = this.decode(sequence, options, compiled);
    return result.complete ? result.tokens : [];
  }
}
