#!/usr/bin/env bun
/**
 * Example emitter — signed WebSocket client that feeds synthetic symbols.
 *
 *   bun run service          # terminal 1
 *   bun run service:emit     # terminal 2
 *
 * Optional: --url ws://127.0.0.1:8787/ws
 */

import { loadOrCreateMeshKeypair } from "@workstream/service-auth";
import { Emitter } from "./emitter";
import { defaultDataDir, emitterKeyPath } from "./server";

const DEFAULT_URL = process.env.WORKSTREAM_SERVICE_URL ?? "ws://127.0.0.1:8787/ws";

/** Synthetic symbols — no Cursor/Jev; enough to exercise learn/decode. */
const SYMBOLS = ["a.|", "b.|", "a.|", "b.|", "a.|", "c.|", "a.|", "b.|"];

function parseUrl(argv: string[]): string {
  let url = DEFAULT_URL;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--url") {
      const next = argv[++i];
      if (!next) {
        console.error("Missing value for --url");
        process.exit(1);
      }
      url = next;
    }
  }
  return url;
}

async function main() {
  const url = parseUrl(Bun.argv.slice(2));
  const keypair = loadOrCreateMeshKeypair(emitterKeyPath(defaultDataDir()), "workstream-emitter");
  const emitter = await Emitter.connect({
    url,
    keypair,
    onEvent: (event) => console.log(JSON.stringify(event)),
  });

  try {
    const latticeId = "emit_demo";
    const streamId = "emit_stream";

    for (const body of [
      { op: "createLattice" as const, latticeId, persistence: { kind: "memory" as const } },
      { op: "createStream" as const, latticeId, streamId },
      { op: "feed" as const, streamId, items: SYMBOLS },
      { op: "snapshot" as const, streamId },
      { op: "end" as const, streamId },
      { op: "closeLattice" as const, latticeId },
    ]) {
      const reply = await emitter.request(body);
      console.log(JSON.stringify(reply));
      if (!reply.ok) process.exit(1);
    }

    console.error(`emitter ok: fed ${SYMBOLS.length} symbols via ${url}`);
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
