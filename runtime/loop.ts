import type { ILattice } from "@khoralabs/tkn";
import type { Encoder, Encoding } from "@/fixtures/encoders";
import type { DecodeSnapshot } from "./decoder";
import { LiveDecoder } from "./decoder";
import { OnlineLearner } from "./learner";
import { orderedConcurrentMap } from "./ordered-map";
import { type PredictionOutcome, type RankedNext, scorePrediction } from "./predictor";

export type TaggedEvent = {
  kind: "tagged";
  index: number;
  symbol: string;
  encoding: Encoding;
};

export type DecodedEvent = {
  kind: "decoded";
  index: number;
  symbol: string;
  snapshot: DecodeSnapshot;
  /**
   * Outcome of the *previous* frame's forecast against this symbol.
   * Absent on the first decoded frame.
   */
  outcome?: PredictionOutcome;
};

export type SessionEndedEvent = {
  kind: "sessionEnded";
  symbolCount: number;
};

export type LoopEvent = TaggedEvent | DecodedEvent | SessionEndedEvent;

export type OnlineLoopMountOptions = {
  learner?: OnlineLearner;
  decoder?: LiveDecoder;
  /** Passed to default OnlineLearner when learner is omitted (default 10). */
  commitBatchSize?: number;
  transitionBatchSize?: number;
};

export type OnlineLoopRunOptions = {
  /** Classify concurrency (default 8). */
  concurrency?: number;
  /** Recompile lattice every N symbols (default 1). */
  recompileEvery?: number;
};

type Classified = {
  index: number;
  encoding: Encoding;
};

/**
 * Online session-span loop: prequential score → learn → flush → decode → forecast.
 * One continuous LZ sequence until the message stream ends.
 */
export class OnlineLoop<TMessage = unknown> {
  readonly encoder: Encoder<TMessage>;
  readonly learner: OnlineLearner;
  readonly decoder: LiveDecoder;

  constructor(encoder: Encoder<TMessage>, lattice: ILattice, options?: OnlineLoopMountOptions) {
    this.encoder = encoder;
    this.learner =
      options?.learner ??
      new OnlineLearner(lattice, {
        commitBatchSize: options?.commitBatchSize,
        transitionBatchSize: options?.transitionBatchSize,
      });
    this.decoder = options?.decoder ?? new LiveDecoder(lattice);
  }

  async *run(
    messages: AsyncIterable<TMessage>,
    opts?: OnlineLoopRunOptions,
  ): AsyncGenerator<LoopEvent> {
    const concurrency = Math.max(1, opts?.concurrency ?? 8);
    const recompileEvery = Math.max(1, opts?.recompileEvery ?? 1);
    let symbolCount = 0;
    let sinceCompile = 0;
    let pendingForecast: RankedNext[] | null = null;

    const classified = orderedConcurrentMap(
      messages,
      async (message, index): Promise<Classified> => ({
        index,
        encoding: await this.encoder.encode(message),
      }),
      { concurrency },
    );

    for await (const item of classified) {
      if (item.encoding.atoms.every((atom) => atom === null)) continue;

      const symbol = this.encoder.compact(item.encoding.atoms);

      // Score previous forecast against arriving symbol *before* learning it.
      const outcome =
        pendingForecast !== null ? scorePrediction(pendingForecast, symbol) : undefined;

      this.learner.pushSymbol(symbol);
      this.learner.flush();
      symbolCount += 1;
      sinceCompile += 1;

      yield {
        kind: "tagged",
        index: item.index,
        symbol,
        encoding: item.encoding,
      };

      if (sinceCompile >= recompileEvery || symbolCount === 1) {
        this.decoder.refresh(this.learner.compile());
        sinceCompile = 0;
      }

      const snapshot = this.decoder.pushSymbol(symbol);
      pendingForecast = snapshot.next;
      yield {
        kind: "decoded",
        index: item.index,
        symbol,
        snapshot,
        outcome,
      };
    }

    await this.learner.endSession();
    this.decoder.refresh(this.learner.compile());
    yield { kind: "sessionEnded", symbolCount };
  }
}
