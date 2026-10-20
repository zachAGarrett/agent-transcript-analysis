import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateMeshKeypair } from "@workstream/service-auth";
import { parseArgs } from "./cli";
import { Emitter, type EmitterEvent } from "./emitter";
import { defaultDataDir, startService } from "./server";

const dataDir = mkdtempSync(join(tmpdir(), "wt-svc-auth-"));
const emitterKp = generateMeshKeypair("workstream-emitter");
const server = startService({
  port: 0,
  hostname: "127.0.0.1",
  dataDir,
  trustedKeys: { [emitterKp.keyid]: emitterKp.publicKey },
});
const base = `ws://${server.hostname}:${server.port}/ws`;

afterAll(() => {
  server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

async function connect(onEvent?: (event: EmitterEvent) => void) {
  return Emitter.connect({
    url: base,
    keypair: emitterKp,
    requestTimeoutMs: 5_000,
    onEvent,
  });
}

describe("workstream service websocket auth", () => {
  test("signed createLattice → createStream → feed → snapshot", async () => {
    const events: EmitterEvent[] = [];
    const emitter = await connect((event) => events.push(event));
    try {
      const lat = await emitter.request({
        op: "createLattice",
        persistence: { kind: "memory" },
      });
      expect(lat).toMatchObject({ ok: true });
      const latticeId = (lat as { result: { latticeId: string } }).result.latticeId;

      const str = await emitter.request({ op: "createStream", latticeId });
      expect(str).toMatchObject({ ok: true });
      const streamId = (str as { result: { streamId: string } }).result.streamId;

      const feed = await emitter.request({
        op: "feed",
        streamId,
        items: ["a.|", "b.|", { symbol: "a.|" }],
      });
      expect(feed).toMatchObject({ ok: true });
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => (e.event as { kind: string }).kind === "tagged")).toBe(true);

      const snap = await emitter.request({ op: "snapshot", streamId });
      expect(snap).toMatchObject({ ok: true });
      const symbols = (snap as { result: { symbols: string[] } }).result.symbols;
      expect(symbols.length).toBe(3);

      await emitter.request({ op: "end", streamId });
      await emitter.request({ op: "closeLattice", latticeId });
    } finally {
      emitter.close();
    }
  });

  test("list, closeStream, and unknown ids", async () => {
    const emitter = await connect();
    try {
      const lat = await emitter.request({
        op: "createLattice",
        persistence: { kind: "memory" },
      });
      const latticeId = (lat as { result: { latticeId: string } }).result.latticeId;
      const str = await emitter.request({ op: "createStream", latticeId });
      const streamId = (str as { result: { streamId: string } }).result.streamId;

      const listed = await emitter.request({ op: "list" });
      expect(listed).toMatchObject({ ok: true });
      expect((listed as { result: { lattices: string[] } }).result.lattices).toContain(latticeId);

      const closed = await emitter.request({ op: "closeStream", streamId });
      expect(closed).toMatchObject({ ok: true });

      const unknownStream = await emitter.request({ op: "snapshot", streamId });
      expect(unknownStream).toMatchObject({
        ok: false,
        error: `unknown stream: ${streamId}`,
      });

      const unknownLattice = await emitter.request({
        op: "createStream",
        latticeId: "missing",
      });
      expect(unknownLattice).toMatchObject({
        ok: false,
        error: "unknown lattice: missing",
      });

      await emitter.request({ op: "closeLattice", latticeId });
    } finally {
      emitter.close();
    }
  });

  test("invalid request shape preserves client id", async () => {
    const emitter = await connect();
    try {
      const reply = await emitter.request({
        id: "req-keep",
        op: 123 as unknown as string,
      });
      expect(reply).toEqual({
        id: "req-keep",
        ok: false,
        error: "invalid request shape",
      });
    } finally {
      emitter.close();
    }
  });

  test("malformed JWS rejects all pending requests", async () => {
    const emitter = await connect();
    try {
      const ws = (emitter as unknown as { ws: WebSocket }).ws;
      const send = ws.send.bind(ws);
      // Drop signed frames; only the bad frame reaches the server.
      ws.send = (() => {
        send("not-a-jws");
      }) as typeof ws.send;
      const results = await Promise.allSettled([
        emitter.request({ op: "list" }),
        emitter.request({ op: "list" }),
      ]);
      expect(results.every((r) => r.status === "rejected")).toBe(true);
      for (const result of results) {
        if (result.status === "rejected") {
          expect(String(result.reason)).toMatch(/expected compact JWS frame/);
        }
      }
    } finally {
      emitter.close();
    }
  });

  test("concurrent requests demux by id", async () => {
    const emitter = await connect();
    try {
      const [a, b] = await Promise.all([
        emitter.request({ op: "createLattice", persistence: { kind: "memory" } }),
        emitter.request({ op: "list" }),
      ]);
      expect(a).toMatchObject({ ok: true });
      expect(b).toMatchObject({ ok: true });
      const latticeId = (a as { result: { latticeId: string } }).result.latticeId;
      await emitter.request({ op: "closeLattice", latticeId });
    } finally {
      emitter.close();
    }
  });

  test("rejects unsigned WebSocket upgrade", async () => {
    const ws = new WebSocket(base);
    const closed = await new Promise<boolean>((resolve) => {
      ws.addEventListener("open", () => resolve(false));
      ws.addEventListener("error", () => resolve(true));
      ws.addEventListener("close", () => resolve(true));
      setTimeout(() => resolve(true), 2000);
    });
    expect(closed).toBe(true);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  });

  test("health endpoint", async () => {
    const res = await fetch(`http://${server.hostname}:${server.port}/health`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("defaultDataDir", () => {
  test("honors WORKSTREAM_DATA_DIR", () => {
    const prev = process.env.WORKSTREAM_DATA_DIR;
    process.env.WORKSTREAM_DATA_DIR = "/tmp/workstream-data-test";
    try {
      expect(defaultDataDir()).toBe("/tmp/workstream-data-test");
    } finally {
      if (prev === undefined) delete process.env.WORKSTREAM_DATA_DIR;
      else process.env.WORKSTREAM_DATA_DIR = prev;
    }
  });
});

describe("service CLI parseArgs", () => {
  test("parses run mode", () => {
    const parsed = parseArgs(["run", '[{"op":"list"}]']);
    expect(parsed.mode).toBe("run");
    expect(parsed.payload).toEqual([{ op: "list" }]);
  });

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
