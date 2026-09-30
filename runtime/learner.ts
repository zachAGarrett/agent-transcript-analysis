import {
  createFeedState,
  createLZSequencer,
  type FeedState,
  type ICompiledLattice,
  type ILattice,
  type ISequencer,
  type LatticeSegment,
  type LmCompileOptions,
  type SequencerOutput,
  Unbounded,
} from "@khoralabs/tkn";

/** Default segment count before commitFeedBatch (online-friendly; tkn feed uses 500). */
export const DEFAULT_COMMIT_BATCH_SIZE = 10;

type WeightedPair = [string, string, number?];

function toSegment(output: SequencerOutput): LatticeSegment {
  return { key: output.key, sequence: output.sequence };
}

function transitionKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function recordTransition(
  counts: Map<string, { from: string; to: string; count: number }>,
  from: string,
  to: string,
): void {
  const key = transitionKey(from, to);
  const entry = counts.get(key);
  if (entry) entry.count += 1;
  else counts.set(key, { from, to, count: 1 });
}

function countsToPairs(
  counts: Map<string, { from: string; to: string; count: number }>,
): WeightedPair[] {
  return [...counts.values()].map(({ from, to, count }) => [from, to, count]);
}

function shouldFlush(
  pendingCount: number,
  transitionCount: number,
  commitBatchSize: number,
  transitionBatchSize: number,
): boolean {
  return pendingCount >= commitBatchSize || transitionCount >= transitionBatchSize;
}

function flushFeedBatch(lattice: ILattice, state: FeedState, transitionBatchSize: number): void {
  const pairs = countsToPairs(state.transitionCounts);
  state.transitionCounts.clear();

  if (pairs.length > transitionBatchSize) {
    const segments = state.pendingSegments.splice(0);
    for (let i = 0; i < pairs.length; i += transitionBatchSize) {
      const pairBatch = pairs.slice(i, i + transitionBatchSize);
      const segmentBatch = i === 0 ? segments : [];
      lattice.commitFeedBatch(segmentBatch, pairBatch);
    }
    return;
  }

  lattice.commitFeedBatch(state.pendingSegments.splice(0), pairs);
}

function processOutputs(
  lattice: ILattice,
  outputs: SequencerOutput[],
  state: FeedState,
  commitBatchSize: number,
  transitionBatchSize: number,
): void {
  for (const output of outputs) {
    const segment = toSegment(output);
    state.pendingSegments.push(segment);

    if (state.previousKey !== null) {
      recordTransition(state.transitionCounts, state.previousKey, segment.key);
    }

    state.previousKey = segment.key;

    if (
      shouldFlush(
        state.pendingSegments.length,
        state.transitionCounts.size,
        commitBatchSize,
        transitionBatchSize,
      )
    ) {
      flushFeedBatch(lattice, state, transitionBatchSize);
    }
  }
}

export type OnlineLearnerOptions = {
  sequencer?: ISequencer;
  /**
   * Flush segments/transitions to the lattice after this many pending segments
   * (default 10). Hosts of the online runtime should set this for learn+decode lag.
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
    this.sequencer.push(symbol);
    processOutputs(
      this.lattice,
      this.sequencer.drainPending(),
      this.feedState,
      this.commitBatchSize,
      this.transitionBatchSize,
    );
  }

  /**
   * Session-span boundary: flush sequencer, commit pending feed batch, clear transition cursor.
   * Single-session-per-run for v1 — do not push after this.
   */
  async endSession(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.sequencer.endSequence();
    processOutputs(
      this.lattice,
      this.sequencer.drainPending(),
      this.feedState,
      this.commitBatchSize,
      this.transitionBatchSize,
    );
    flushFeedBatch(this.lattice, this.feedState, this.transitionBatchSize);
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
