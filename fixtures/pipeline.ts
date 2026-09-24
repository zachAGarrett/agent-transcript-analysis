import type { Encoder, Encoding } from "./encoders";

/**
 * Tagging pipeline. Turns messages into encodings via a versioned encoder.
 * Does not write files and does not call tkn.
 */
export class Pipeline<TMessage = unknown> {
  constructor(readonly encoder: Encoder<TMessage>) {}

  processOne(message: TMessage): Promise<Encoding> {
    return this.encoder.encode(message);
  }

  async *feed(
    messages: AsyncIterable<TMessage> | AsyncIterator<TMessage>,
  ): AsyncGenerator<Encoding> {
    const iterable =
      Symbol.asyncIterator in messages ? messages : { [Symbol.asyncIterator]: () => messages };

    for await (const message of iterable) {
      yield await this.processOne(message);
    }
  }
}
