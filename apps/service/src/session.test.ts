import { afterAll, describe, expect, test } from "bun:test";
import { parseArgs } from "./cli";
import { startService } from "./server";

const server = startService({ port: 0, hostname: "127.0.0.1" });
const base = `ws://${server.hostname}:${server.port}/ws`;

afterAll(() => {
  server.stop(true);
});

async function openSession() {
  const ws = new WebSocket(base);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", reject);
  });

  async function rpc(
    body: Record<string, unknown>,
  ): Promise<{ events: unknown[]; reply: unknown }> {
    const id = crypto.randomUUID();
    const events: unknown[] = [];
    let reply: unknown;
    await new Promise<void>((resolve, reject) => {
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as { id?: string; type?: string };
        if (msg.type === "event") {
          events.push(msg);
          return;
        }
        if (msg.id === id) {
          reply = msg;
          ws.removeEventListener("message", onMessage);
          resolve();
        }
      };
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", reject);
      ws.send(JSON.stringify({ id, ...body }));
    });
    return { events, reply };
  }

  return { ws, rpc };
}

describe("workstream service websocket", () => {
  test("createLattice → createStream → feed → snapshot on one session", async () => {
    const { ws, rpc } = await openSession();
    try {
      const lat = await rpc({
        op: "createLattice",
        persistence: { kind: "memory" },
      });
      expect(lat.reply).toMatchObject({ ok: true });
      const latticeId = (lat.reply as { result: { latticeId: string } }).result.latticeId;

      const str = await rpc({ op: "createStream", latticeId });
      expect(str.reply).toMatchObject({ ok: true });
      const streamId = (str.reply as { result: { streamId: string } }).result.streamId;

      const feed = await rpc({
        op: "feed",
        streamId,
        items: ["a.|", "b.|", { symbol: "a.|" }],
      });
      expect(feed.reply).toMatchObject({ ok: true });
      expect(feed.events.length).toBeGreaterThan(0);
      expect(
        feed.events.some((e) => (e as { event: { kind: string } }).event.kind === "tagged"),
      ).toBe(true);

      const snap = await rpc({ op: "snapshot", streamId });
      expect(snap.reply).toMatchObject({ ok: true });
      const symbols = (snap.reply as { result: { symbols: string[] } }).result.symbols;
      expect(symbols.length).toBe(3);

      await rpc({ op: "end", streamId });
      await rpc({ op: "closeLattice", latticeId });
    } finally {
      ws.close();
    }
  });

  test("list, closeStream, and unknown ids", async () => {
    const { ws, rpc } = await openSession();
    try {
      const lat = await rpc({
        op: "createLattice",
        persistence: { kind: "memory" },
      });
      const latticeId = (lat.reply as { result: { latticeId: string } }).result.latticeId;
      const str = await rpc({ op: "createStream", latticeId });
      const streamId = (str.reply as { result: { streamId: string } }).result.streamId;

      const listed = await rpc({ op: "list" });
      expect(listed.reply).toMatchObject({ ok: true });
      expect((listed.reply as { result: { lattices: string[] } }).result.lattices).toContain(
        latticeId,
      );

      const closed = await rpc({ op: "closeStream", streamId });
      expect(closed.reply).toMatchObject({ ok: true });

      const unknownStream = await rpc({ op: "snapshot", streamId });
      expect(unknownStream.reply).toMatchObject({
        ok: false,
        error: `unknown stream: ${streamId}`,
      });

      const unknownLattice = await rpc({ op: "createStream", latticeId: "missing" });
      expect(unknownLattice.reply).toMatchObject({
        ok: false,
        error: "unknown lattice: missing",
      });

      await rpc({ op: "closeLattice", latticeId });
    } finally {
      ws.close();
    }
  });

  test("invalid request shape preserves client id", async () => {
    const ws = new WebSocket(base);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", reject);
    });
    try {
      const reply = await new Promise<unknown>((resolve, reject) => {
        const onMessage = (ev: MessageEvent) => {
          ws.removeEventListener("message", onMessage);
          resolve(JSON.parse(String(ev.data)));
        };
        ws.addEventListener("message", onMessage);
        ws.addEventListener("error", reject);
        ws.send(JSON.stringify({ id: "req-keep", op: 123 }));
      });
      expect(reply).toEqual({
        id: "req-keep",
        ok: false,
        error: "invalid request shape",
      });
    } finally {
      ws.close();
    }
  });

  test("health endpoint", async () => {
    const res = await fetch(`http://${server.hostname}:${server.port}/health`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("service CLI parseArgs", () => {
  test("recognizes help flags without treating them as ops", () => {
    expect(parseArgs(["--help"]).mode).toBe("help");
    expect(parseArgs(["-h"]).mode).toBe("help");
    expect(parseArgs(["--url", "ws://x", "--help"]).mode).toBe("help");
  });

  test("CLI --help prints usage and exits non-zero", async () => {
    const proc = Bun.spawn(["bun", "apps/service/src/cli.ts", "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).toContain("createLattice");
  });
});
