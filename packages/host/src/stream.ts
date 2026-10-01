import type { LatticeRef, PreprocessFn, StreamHandle } from "./contracts";
import type { DecodeSnapshot } from "./decoder";
import { LiveDecoder } from "./decoder";
import { DEFAULT_COMMIT_BATCH_SIZE, OnlineLearner, type OnlineLearnerOptions } from "./learner";
import type { LoopEvent } from "./loop";
import { orderedConcurrentMap } from "./ordered-map";
import { type PredictionOutcome, type RankedNext, scorePrediction } from "./predictor";

export type CreateStreamRunnerOptions<T> = {
  lattice: LatticeRef;
  preprocess: PreprocessFn<T>;
  concurrency?: number;
  recompileEvery?: number;
  learner?: OnlineLearnerOptions;
};

/**
 * Single-writer stream: ordered concurrent preprocess, then serial learn/decode
 * under the lattice mutex.
 */
export function createStreamRunner<T>(options: CreateStreamRunnerOptions<T>): StreamHandle<T> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const recompileEvery = Math.max(1, options.recompileEvery ?? 1);
  const learner = new OnlineLearner(options.lattice.lattice, {
    commitBatchSize: options.learner?.commitBatchSize ?? DEFAULT_COMMIT_BATCH_SIZE,
    transitionBatchSize: options.learner?.transitionBatchSize,
  });
  const decoder = new LiveDecoder(options.lattice.lattice);

  let feeding = false;
  let ended = false;
  let closed = false;
  let pendingForecast: RankedNext[] | null = null;

  async function assertOpen(): Promise<void> {
    if (closed) throw new Error("StreamHandle is closed");
  }

  return {
    async *feed(source: AsyncIterable<T>): AsyncGenerator<LoopEvent> {
      await assertOpen();
      if (ended) throw new Error("StreamHandle has ended");
      if (feeding) throw new Error("StreamHandle.feed is not re-entrant (single-writer)");
      feeding = true;
      try {
        let symbolCount = 0;
        let sinceCompile = 0;

        const classified = orderedConcurrentMap(
          source,
          async (item, index) => ({
            index,
            symbol: await options.preprocess(item, index),
          }),
          { concurrency },
        );

        for await (const item of classified) {
          if (item.symbol === null) continue;

          const symbol = item.symbol;
          const outcome: PredictionOutcome | undefined =
            pendingForecast !== null ? scorePrediction(pendingForecast, symbol) : undefined;

          await options.lattice.runExclusive(() => {
            learner.pushSymbol(symbol);
            learner.flush();
          });
          symbolCount += 1;
          sinceCompile += 1;

          yield { kind: "tagged", index: item.index, symbol };

          if (sinceCompile >= recompileEvery || symbolCount === 1) {
            await options.lattice.runExclusive(() => {
              decoder.refresh(learner.compile());
            });
            sinceCompile = 0;
          }

          const snapshot = decoder.pushSymbol(symbol);
          pendingForecast = snapshot.next;
          yield {
            kind: "decoded",
            index: item.index,
            symbol,
            snapshot,
            outcome,
          };
        }
      } finally {
        feeding = false;
      }
    },

    snapshot(): DecodeSnapshot {
      return decoder.snapshot();
    },

    async end(): Promise<void> {
      await assertOpen();
      if (ended) return;
      ended = true;
      await options.lattice.runExclusive(async () => {
        await learner.endSession();
        decoder.refresh(learner.compile());
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      if (!ended) await this.end();
      closed = true;
    },
  };
}
