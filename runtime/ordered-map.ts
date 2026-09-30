export type OrderedConcurrentMapOptions = {
  /** Max in-flight map calls (default 8). */
  concurrency?: number;
};

/**
 * Map an async iterable with bounded concurrency, yielding results in source order.
 */
export async function* orderedConcurrentMap<T, U>(
  source: AsyncIterable<T> | AsyncIterator<T>,
  mapFn: (item: T, index: number) => Promise<U>,
  options?: OrderedConcurrentMapOptions,
): AsyncGenerator<U> {
  const concurrency = Math.max(1, options?.concurrency ?? 8);
  const iterable =
    Symbol.asyncIterator in source ? source : { [Symbol.asyncIterator]: () => source };
  const iterator = iterable[Symbol.asyncIterator]();

  type Slot =
    | { status: "pending"; promise: Promise<void> }
    | { status: "ready"; value: U }
    | { status: "error"; error: unknown };

  const buffer = new Map<number, Slot>();
  let nextIndex = 0;
  let yieldIndex = 0;
  let sourceDone = false;
  let inFlight = 0;
  let wake: (() => void) | null = null;

  const signal = () => {
    wake?.();
    wake = null;
  };

  const wait = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });

  const startOne = (index: number, item: T) => {
    inFlight += 1;
    const promise = mapFn(item, index)
      .then((value) => {
        buffer.set(index, { status: "ready", value });
      })
      .catch((error: unknown) => {
        buffer.set(index, { status: "error", error });
      })
      .finally(() => {
        inFlight -= 1;
        signal();
      });
    buffer.set(index, { status: "pending", promise });
  };

  const fill = async () => {
    while (!sourceDone && inFlight < concurrency) {
      const { value, done } = await iterator.next();
      if (done) {
        sourceDone = true;
        signal();
        return;
      }
      const index = nextIndex;
      nextIndex += 1;
      startOne(index, value);
    }
  };

  await fill();

  try {
    while (yieldIndex < nextIndex || !sourceDone || inFlight > 0) {
      const slot = buffer.get(yieldIndex);
      if (slot?.status === "ready") {
        buffer.delete(yieldIndex);
        yieldIndex += 1;
        yield slot.value;
        await fill();
        continue;
      }
      if (slot?.status === "error") {
        buffer.delete(yieldIndex);
        throw slot.error;
      }
      if (sourceDone && inFlight === 0 && yieldIndex >= nextIndex) break;
      await wait();
    }
  } finally {
    if (!sourceDone) {
      sourceDone = true;
      await iterator.return?.(undefined);
    }
  }
}
