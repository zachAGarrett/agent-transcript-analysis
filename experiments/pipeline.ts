import {
  createFeedState,
  createLZSequencer,
  createViterbiContext,
  decode as decodeLattice,
  feedInputStream,
  type ILattice,
  type LatticeDecodeOptions,
  type MatchCandidate,
  type SequencerInput,
  Unbounded,
} from "@khoralabs/tkn";
import type { Producer, Sequence } from "./producers";

async function* symbolSource(symbols: string[]): AsyncGenerator<SequencerInput> {
  for (const symbol of symbols) yield symbol;
}

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

  /** Ingest one sequence; clears the lattice transition cursor afterward. */
  async processOne(sequence: Sequence): Promise<void> {
    if (sequence.symbols.length === 0) return;
    await feedInputStream(
      this.lattice,
      this.sequencer,
      symbolSource(sequence.symbols),
      this.feedState,
      1000,
    );
    this.feedState.previousKey = null;
  }

  async *feed(producer: Producer): AsyncGenerator<Sequence> {
    for await (const sequence of producer.sequences()) {
      await this.processOne(sequence);
      yield sequence;
    }
  }

  /**
   * Segment a symbol sequence with Viterbi or beam.
   * Offsets are symbol indices, not characters.
   */
  decode(sequence: Sequence, options?: LatticeDecodeOptions): string[] {
    const symbols = sequence.symbols;
    const n = symbols.length;
    if (n === 0) return [];

    const compiled = this.lattice.compile();
    const vocab = new Set(this.lattice.vocabulary());
    // Placeholder string of length n so decode walks by symbol index.
    const placeholder = "\u0001".repeat(n);

    const matchCandidates = (_input: string, offset: number): MatchCandidate[] => {
      const candidates: MatchCandidate[] = [];
      let concat = "";
      for (let k = 1; offset + k <= n; k++) {
        const next = symbols[offset + k - 1];
        if (next === undefined) break;
        concat += next;
        if (vocab.has(concat)) {
          candidates.push({ pattern: concat, length: k });
        }
      }
      // Always allow the single next symbol (unknown patterns still segment).
      const one = symbols[offset];
      if (one !== undefined && !candidates.some((c) => c.length === 1 && c.pattern === one)) {
        candidates.push({ pattern: one, length: 1 });
      }
      return candidates;
    };

    const ctx = createViterbiContext({
      matchCandidates,
      getTokenCount: () => 0,
      getTotalEmissions: () => 0,
      getVocabSize: () => 0,
      getTransitionWeight: () => null,
      getOutgoingTotal: () => 0,
      emissionLogProb: (token) => compiled.emissionLogProb(token),
      transitionLogProb: (from, to) => compiled.transitionLogProb(from, to),
    });

    return decodeLattice(placeholder, ctx, options);
  }
}
