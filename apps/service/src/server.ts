import { join } from "node:path";
import {
  loadOrCreateMeshKeypair,
  loadTrustFromEnv,
  lookupTrustedPublicKey,
  resetTrustStore,
  setTrustedPublicKeys,
  verifyJwsCompact,
  verifyRequest,
} from "@workstream/service-auth";
import {
  type ClientRequest,
  closeSession,
  createMutex,
  createSessionState,
  handleRequest,
  type SessionState,
} from "./session";

export type SocketData = {
  session: SessionState;
};

const DEFAULT_PORT = Number(process.env.WORKSTREAM_SERVICE_PORT ?? 8787);
const DEFAULT_HOST = process.env.WORKSTREAM_SERVICE_HOST ?? "127.0.0.1";

/** Serialize HTTP→WS upgrades and connection registry churn. */
const upgradeMutex = createMutex();

export type StartServiceOptions = {
  port?: number;
  hostname?: string;
  /** Key material directory (default `.data/workstream`). */
  dataDir?: string;
  /**
   * When set, reset trust and use only these keys (tests).
   * Keys are kid → multibase public key.
   */
  trustedKeys?: Record<string, string>;
};

export function defaultDataDir(): string {
  const fromEnv = process.env.WORKSTREAM_DATA_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(process.cwd(), ".data", "workstream");
}

export function emitterKeyPath(dataDir = defaultDataDir()): string {
  return join(dataDir, "emitter-ed25519.json");
}

export function serviceKeyPath(dataDir = defaultDataDir()): string {
  return join(dataDir, "service-ed25519.json");
}

/** Boot mesh identity + trust store for emitters. */
export function bootAuth(options?: {
  dataDir?: string;
  trustedKeys?: Record<string, string>;
}): void {
  const dataDir = options?.dataDir ?? defaultDataDir();
  loadOrCreateMeshKeypair(serviceKeyPath(dataDir), "workstream-service");

  if (options?.trustedKeys) {
    resetTrustStore();
    setTrustedPublicKeys(options.trustedKeys);
    return;
  }

  resetTrustStore();
  loadTrustFromEnv();
  if (!lookupTrustedPublicKey("workstream-emitter")) {
    const emitter = loadOrCreateMeshKeypair(emitterKeyPath(dataDir), "workstream-emitter");
    setTrustedPublicKeys({ "workstream-emitter": emitter.publicKey });
  }
}

function extractJws(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as { jws?: unknown };
      return typeof obj.jws === "string" ? obj.jws : null;
    } catch {
      return null;
    }
  }
  // Compact JWS has exactly two dots
  if (trimmed.split(".").length === 3) return trimmed;
  return null;
}

export function startService(options?: StartServiceOptions) {
  const port = options?.port ?? DEFAULT_PORT;
  const hostname = options?.hostname ?? DEFAULT_HOST;
  bootAuth({ dataDir: options?.dataDir, trustedKeys: options?.trustedKeys });

  const server = Bun.serve<SocketData>({
    port,
    hostname,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true });
      }
      if (url.pathname !== "/ws") {
        return new Response("Not found", { status: 404 });
      }

      const verified = await verifyRequest(req, lookupTrustedPublicKey);
      if (!verified.ok) {
        return new Response(JSON.stringify({ error: verified.error }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }

      return upgradeMutex(async () => {
        const session = createSessionState();
        const upgraded = server.upgrade(req, { data: { session } });
        if (!upgraded) {
          return new Response("WebSocket upgrade failed", { status: 400 });
        }
        return undefined;
      });
    },
    websocket: {
      open() {
        /* session created at upgrade */
      },
      async message(ws, raw) {
        const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
        const jws = extractJws(text);
        if (jws === null) {
          ws.send(JSON.stringify({ id: "?", ok: false, error: "expected compact JWS frame" }));
          return;
        }

        const verified = verifyJwsCompact(jws, lookupTrustedPublicKey);
        if (!verified.ok) {
          ws.send(JSON.stringify({ id: "?", ok: false, error: verified.error }));
          return;
        }

        let req: ClientRequest;
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(verified.payload));
          const requestId =
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as { id?: unknown }).id === "string"
              ? (parsed as { id: string }).id
              : "?";
          req = parsed as ClientRequest;
          if (
            !req ||
            typeof req !== "object" ||
            typeof req.id !== "string" ||
            typeof req.op !== "string"
          ) {
            ws.send(JSON.stringify({ id: requestId, ok: false, error: "invalid request shape" }));
            return;
          }
        } catch {
          ws.send(JSON.stringify({ id: "?", ok: false, error: "invalid JWS payload JSON" }));
          return;
        }

        const { reply, events } = await handleRequest(ws.data.session, req);
        if (events) {
          for (const event of events) {
            ws.send(JSON.stringify(event));
          }
        }
        ws.send(JSON.stringify(reply));
      },
      async close(ws) {
        await closeSession(ws.data.session);
      },
    },
  });

  return server;
}

if (import.meta.main) {
  const server = startService();
  console.log(`workstream service listening on ws://${server.hostname}:${server.port}/ws`);
}
