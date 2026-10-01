import {
  createFeedState,
  createLZSequencer,
  type FeedState,
  feedInput,
  flushFeedState,
  type ICompiledLattice,
  type ILattice,
  type ISequencer,
  type LatticeSegment,
  type LmCompileOptions,
  type SequencerOutput,
  Unbounded,
} from "@khoralabs/tkn";

/** Default segment count before flush (online-friendly; tkn auto-flush uses 500). */
export const DEFAULT_COMMIT_BATCH_SIZE = 10;

function toSegment(output: SequencerOutput): LatticeSegment {
  return { key: output.key, sequence: output.sequence };
}

function transitionKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

/**
 * After sequencer.endSequence(), drain the final tip into FeedState.
 * tkn 0.2.1 has no exported endFeedSequence helper.
 */
function absorbFinalOutputs(state: FeedState, outputs: SequencerOutput[]): void {
  for (const output of outputs) {
    const segment = toSegment(output);
    state.pendingSegments.push(segment);
    if (state.previousKey !== null) {
      const key = transitionKey(state.previousKey, segment.key);
      const entry = state.transitionCounts.get(key);
      if (entry) entry.count += 1;
      else state.transitionCounts.set(key, { from: state.previousKey, to: segment.key, count: 1 });
    }
    state.previousKey = segment.key;
  }
}

export type OnlineLearnerOptions = {
  sequencer?: ISequencer;
  /**
   * Flush segments/transitions to the lattice after this many pending segments
   * (default 10). Online forecast loops also call flush() explicitly each step.
   */
  commitBatchSize?: number;
  /** Transition map flush threshold when splitting large pair batches (default 1000). */
  transitionBatchSize?: number;
};

/**
 * Symbol-grain lattice learner for one session-span sequence.
 * Call endSession() once when the stream closes — not between messages.
 */
export class OnlineLearner {
  readonly lattice: ILattice;
  readonly commitBatchSize: number;
  private readonly sequencer: ISequencer;
  private readonly feedState: FeedState;
  private readonly transitionBatchSize: number;
  private readonly ownsSequencer: boolean;
  private ended = false;

  constructor(lattice: ILattice, options?: OnlineLearnerOptions) {
    this.lattice = lattice;
    this.ownsSequencer = options?.sequencer === undefined;
    this.sequencer =
      options?.sequencer ??
      createLZSequencer({
        cacheOptions: new Unbounded(),
        historyOptions: { bounded: false },
      });
    this.feedState = createFeedState();
    this.commitBatchSize = Math.max(1, options?.commitBatchSize ?? DEFAULT_COMMIT_BATCH_SIZE);
    this.transitionBatchSize = Math.max(1, options?.transitionBatchSize ?? 1000);
  }

  /** Push one compacted composite without ending the LZ sequence. */
  pushSymbol(symbol: string): void {
    if (this.ended) throw new Error("OnlineLearner: session already ended");
    if (symbol.length === 0) return;
    feedInput(this.lattice, this.sequencer, symbol, this.feedState, this.transitionBatchSize);
    if (this.feedState.pendingSegments.length >= this.commitBatchSize) {
      this.flush();
    }
  }

  /**
   * Commit emitted segments/transitions without ending the LZ sequence.
   * Call before compile/predict so getNext sees the latest completed edges.
   */
  flush(): void {
    flushFeedState(this.lattice, this.feedState, this.transitionBatchSize);
  }

  /**
   * Session-span boundary: flush sequencer tip, commit pending feed batch, clear cursor.
   * Single-session-per-run for v1 — do not push after this.
   */
  async endSession(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.sequencer.endSequence();
    absorbFinalOutputs(this.feedState, this.sequencer.drainPending());
    this.flush();
    this.feedState.previousKey = null;
  }

  compile(options?: LmCompileOptions): ICompiledLattice {
    return this.lattice.compile(options);
  }

  async close(): Promise<void> {
    await this.endSession();
    if (this.ownsSequencer) await this.sequencer.close();
  }
}
