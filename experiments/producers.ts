/** One session (or turn) of compacted composite symbols. */
export type Sequence = {
  id: string;
  /** One compacted composite symbol per step, in order. */
  symbols: string[];
  /**
   * Metadata kept beside the feed, never pushed into the lattice.
   * Agent-turn uses `intent` from the preceding user message.
   */
  meta?: {
    intent?: string | null;
  };
};

/** Streams sequences into an experiment pipeline. */
export type Producer = {
  sequences(): AsyncGenerator<Sequence>;
};

/** Wrap a fixed list as a producer. */
export function producerFrom(sequences: Sequence[]): Producer {
  return {
    async *sequences() {
      for (const sequence of sequences) yield sequence;
    },
  };
}
