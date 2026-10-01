#!/usr/bin/env bun
/**
 * Management CLI — WebSocket client for apps/service (one session per process).
 *
 * Usage:
 *   bun apps/service/src/cli.ts [--url ws://127.0.0.1:8787/ws] <op> [json-args]
 *   bun apps/service/src/cli.ts [--url …] run '<json-array-of-ops>'
 *
 * Single ops share one connection only within `run`. Prefer `run` for multi-step flows.
 */

function usage(): never {
  console.error(`Usage:
  workstream-service [--url ws://host:port/ws] <op> [json-body]
  workstream-service [--url ws://host:port/ws] run '<[{op,…},…]>'

Ops: createLattice | createStream | feed | snapshot | end | closeStream | closeLattice | list
`);
  process.exit(1);
}

export function parseArgs(argv: string[]): {
  url: string;
  mode: "one" | "run" | "help";
  op?: string;
  payload: unknown;
} {
  let url = process.env.WORKSTREAM_SERVICE_URL ?? "ws://127.0.0.1:8787/ws";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      return { url, mode: "help", payload: null };
    }
    if (arg === "--url") {
      const next = argv[++i];
      if (!next) usage();
      url = next;
      continue;
    }
    rest.push(arg);
  }
  const head = rest[0];
  if (!head) usage();
  if (head === "--help" || head === "-h") {
    return { url, mode: "help", payload: null };
  }
  if (head === "run") {
    const body = rest[1];
    if (!body) usage();
    try {
      return { url, mode: "run", payload: JSON.parse(body) };
    } catch {
      console.error("Invalid JSON array for run");
      process.exit(1);
    }
  }
  let payload: Record<string, unknown> = {};
  if (rest[1]) {
    try {
      payload = JSON.parse(rest[1]) as Record<string, unknown>;
    } catch {
      console.error("Invalid JSON body");
      process.exit(1);
    }
  }
  return { url, mode: "one", op: head, payload };
}

async function withSession(
  url: string,
  ops: Array<Record<string, unknown>>,
): Promise<{ ok: boolean; messages: unknown[] }> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (ev: Event) => {
      cleanup();
      reject(ev);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before open"));
    };
    const cleanup = () => {
      ws.removeEventListener("open", onOpen);
      ws.removeEventListener("error", onError);
      ws.removeEventListener("close", onClose);
    };
    ws.addEventListener("open", onOpen);
    ws.addEventListener("error", onError);
    ws.addEventListener("close", onClose);
  });

  const messages: unknown[] = [];
  let failed = false;

  for (const op of ops) {
    const id = crypto.randomUUID();
    await new Promise<void>((resolve, reject) => {
      const settle = (fn: () => void) => {
        ws.removeEventListener("message", onMessage);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        fn();
      };
      const onMessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { id?: string; ok?: boolean; type?: string };
          messages.push(msg);
          console.log(JSON.stringify(msg));
          if (msg.id === id) {
            if (msg.ok === false) failed = true;
            settle(() => resolve());
          }
        } catch (error) {
          settle(() => reject(error));
        }
      };
      const onError = (ev: Event) => settle(() => reject(ev));
      const onClose = () => settle(() => reject(new Error("WebSocket closed before reply")));
      ws.addEventListener("message", onMessage);
      ws.addEventListener("error", onError);
      ws.addEventListener("close", onClose);
      ws.send(JSON.stringify({ id, ...op }));
    });
    if (failed) break;
  }

  ws.close();
  return { ok: !failed, messages };
}

async function main() {
  const parsed = parseArgs(Bun.argv.slice(2));
  if (parsed.mode === "help") usage();
  const ops =
    parsed.mode === "run"
      ? (parsed.payload as Array<Record<string, unknown>>)
      : [{ op: parsed.op, ...(parsed.payload as object) }];
  if (!Array.isArray(ops) || ops.length === 0) {
    console.error("run expects a non-empty JSON array");
    process.exit(1);
  }
  const { ok } = await withSession(parsed.url, ops);
  if (!ok) process.exit(1);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
