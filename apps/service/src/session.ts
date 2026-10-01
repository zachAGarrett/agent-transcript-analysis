import type { LatticePersistence, LatticeRef, LoopEvent, StreamHandle } from "@workstream/host";
import { createStreamRunner, openLattice } from "@workstream/host";

/** Serialize async work (used for WebSocket upgrade / registry updates). */
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = tail.then(() => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

/** Default host preprocess: string symbols or `{ symbol }` objects. */
export async function defaultPreprocess(item: unknown): Promise<string | null> {
  if (typeof item === "string") return item.length > 0 ? item : null;
  if (item && typeof item === "object" && "symbol" in item) {
    const symbol = (item as { symbol: unknown }).symbol;
    return typeof symbol === "string" && symbol.length > 0 ? symbol : null;
  }
  return null;
}

export type SessionState = {
  lattices: Map<string, LatticeRef>;
  streams: Map<string, { latticeId: string; handle: StreamHandle<unknown> }>;
};

export function createSessionState(): SessionState {
  return { lattices: new Map(), streams: new Map() };
}

export type ClientRequest =
  | {
      id: string;
      op: "createLattice";
      persistence: LatticePersistence;
      latticeId?: string;
    }
  | {
      id: string;
      op: "createStream";
      latticeId: string;
      streamId?: string;
      concurrency?: number;
    }
  | { id: string; op: "feed"; streamId: string; items: unknown[] }
  | { id: string; op: "snapshot"; streamId: string }
  | { id: string; op: "end"; streamId: string }
  | { id: string; op: "closeStream"; streamId: string }
  | { id: string; op: "closeLattice"; latticeId: string }
  | { id: string; op: "list" };

export type ServerReply =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string };

export type ServerEvent = {
  type: "event";
  streamId: string;
  event: LoopEvent;
};

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export async function handleRequest(
  session: SessionState,
  req: ClientRequest,
): Promise<{ reply: ServerReply; events?: ServerEvent[] }> {
  try {
    switch (req.op) {
      case "createLattice": {
        const latticeId = req.latticeId ?? newId("lat");
        if (session.lattices.has(latticeId)) {
          return { reply: { id: req.id, ok: false, error: `lattice exists: ${latticeId}` } };
        }
        const ref = await openLattice(req.persistence, { id: latticeId });
        session.lattices.set(latticeId, ref);
        return {
          reply: {
            id: req.id,
            ok: true,
            result: { latticeId, persistence: req.persistence },
          },
        };
      }
      case "createStream": {
        const ref = session.lattices.get(req.latticeId);
        if (!ref) {
          return { reply: { id: req.id, ok: false, error: `unknown lattice: ${req.latticeId}` } };
        }
        const streamId = req.streamId ?? newId("str");
        if (session.streams.has(streamId)) {
          return { reply: { id: req.id, ok: false, error: `stream exists: ${streamId}` } };
        }
        const handle = createStreamRunner({
          lattice: ref,
          preprocess: defaultPreprocess,
          concurrency: req.concurrency,
        });
        session.streams.set(streamId, { latticeId: req.latticeId, handle });
        return {
          reply: {
            id: req.id,
            ok: true,
            result: { streamId, latticeId: req.latticeId },
          },
        };
      }
      case "feed": {
        const entry = session.streams.get(req.streamId);
        if (!entry) {
          return { reply: { id: req.id, ok: false, error: `unknown stream: ${req.streamId}` } };
        }
        const events: ServerEvent[] = [];
        const batch = req.items;
        const streamId = req.streamId;
        async function* items() {
          for (const item of batch) yield item;
        }
        for await (const event of entry.handle.feed(items())) {
          events.push({ type: "event", streamId, event });
        }
        return {
          reply: { id: req.id, ok: true, result: { eventCount: events.length } },
          events,
        };
      }
      case "snapshot": {
        const entry = session.streams.get(req.streamId);
        if (!entry) {
          return { reply: { id: req.id, ok: false, error: `unknown stream: ${req.streamId}` } };
        }
        return {
          reply: { id: req.id, ok: true, result: entry.handle.snapshot() },
        };
      }
      case "end": {
        const entry = session.streams.get(req.streamId);
        if (!entry) {
          return { reply: { id: req.id, ok: false, error: `unknown stream: ${req.streamId}` } };
        }
        await entry.handle.end();
        return { reply: { id: req.id, ok: true, result: { ended: true } } };
      }
      case "closeStream": {
        const entry = session.streams.get(req.streamId);
        if (!entry) {
          return { reply: { id: req.id, ok: false, error: `unknown stream: ${req.streamId}` } };
        }
        await entry.handle.close();
        session.streams.delete(req.streamId);
        return { reply: { id: req.id, ok: true, result: { closed: true } } };
      }
      case "closeLattice": {
        const ref = session.lattices.get(req.latticeId);
        if (!ref) {
          return { reply: { id: req.id, ok: false, error: `unknown lattice: ${req.latticeId}` } };
        }
        for (const [streamId, entry] of [...session.streams]) {
          if (entry.latticeId === req.latticeId) {
            await entry.handle.close();
            session.streams.delete(streamId);
          }
        }
        ref.close();
        session.lattices.delete(req.latticeId);
        return { reply: { id: req.id, ok: true, result: { closed: true } } };
      }
      case "list": {
        return {
          reply: {
            id: req.id,
            ok: true,
            result: {
              lattices: [...session.lattices.keys()],
              streams: [...session.streams.entries()].map(([streamId, e]) => ({
                streamId,
                latticeId: e.latticeId,
              })),
            },
          },
        };
      }
      default: {
        const _exhaustive: never = req;
        return {
          reply: {
            id: (req as { id: string }).id,
            ok: false,
            error: `unknown op: ${JSON.stringify(_exhaustive)}`,
          },
        };
      }
    }
  } catch (error) {
    return {
      reply: {
        id: req.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function closeSession(session: SessionState): Promise<void> {
  for (const entry of session.streams.values()) {
    await entry.handle.close().catch(() => undefined);
  }
  session.streams.clear();
  for (const ref of session.lattices.values()) {
    ref.close();
  }
  session.lattices.clear();
}
