#!/usr/bin/env bun
/**
 * Management CLI — signed WebSocket client (Emitter) for apps/service.
 *
 * Usage:
 *   bun apps/service/src/cli.ts [--url ws://127.0.0.1:8787/ws] <op> [json-args]
 *   bun apps/service/src/cli.ts [--url …] run '<json-array-of-ops>'
 */

import { loadOrCreateMeshKeypair } from "@workstream/service-auth";
import { Emitter } from "./emitter";
import { defaultDataDir, emitterKeyPath } from "./server";

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

  const keypair = loadOrCreateMeshKeypair(emitterKeyPath(defaultDataDir()), "workstream-emitter");
  const emitter = await Emitter.connect({
    url: parsed.url,
    keypair,
    onEvent: (event) => console.log(JSON.stringify(event)),
  });

  try {
    for (const op of ops) {
      const reply = await emitter.request(op as Parameters<Emitter["request"]>[0]);
      console.log(JSON.stringify(reply));
      if (!reply.ok) process.exit(1);
    }
  } finally {
    emitter.close();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
