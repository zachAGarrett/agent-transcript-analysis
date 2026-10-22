import { join } from "node:path";
import {
  defaultTokenStore,
  issueOpenGrant,
  loadOrCreateMeshKeypair,
  parseGnapAuthorization,
  verifyGrantIncoming,
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
  /** Key bound to the GNAP access token used at upgrade. */
  clientKeyid: string;
  clientPublicKey: string;
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
  /** Inject a token store (tests). Defaults to shared in-memory store. */
  tokenStore?: typeof defaultTokenStore;
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

/** Boot service identity only (no static emitter trust). */
export function bootAuth(options?: { dataDir?: string }): void {
  const dataDir = options?.dataDir ?? defaultDataDir();
  loadOrCreateMeshKeypair(serviceKeyPath(dataDir), "workstream-service");
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

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function startService(options?: StartServiceOptions) {
  const port = options?.port ?? DEFAULT_PORT;
  const hostname = options?.hostname ?? DEFAULT_HOST;
  const tokens = options?.tokenStore ?? defaultTokenStore;
  bootAuth({ dataDir: options?.dataDir });

  const server = Bun.serve<SocketData>({
    port,
    hostname,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/health") {
        return Response.json({ ok: true });
      }

      if (url.pathname === "/gnap" && req.method === "POST") {
        const verified = await verifyGrantIncoming(req);
        if (!verified.ok) {
          return jsonError(401, verified.error);
        }
        const grant = issueOpenGrant(verified, tokens);
        return Response.json(grant);
      }

      if (url.pathname !== "/ws") {
        return new Response("Not found", { status: 404 });
      }

      const tokenValue = parseGnapAuthorization(req.headers.get("authorization"));
      if (tokenValue === null) {
        return jsonError(401, "missing GNAP authorization");
      }
      const record = tokens.lookup(tokenValue);
      if (!record) {
        return jsonError(401, "invalid or expired access token");
      }

      const verified = await verifyRequest(req, (keyid) =>
        keyid === record.keyid ? record.publicKey : undefined,
      );
      if (!verified.ok) {
        return jsonError(401, verified.error);
      }
      if (verified.keyid !== record.keyid) {
        return jsonError(401, "signature keyid does not match token");
      }

      return upgradeMutex(async () => {
        const session = createSessionState();
        const upgraded = server.upgrade(req, {
          data: {
            session,
            clientKeyid: record.keyid,
            clientPublicKey: record.publicKey,
          },
        });
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

        const { clientKeyid, clientPublicKey } = ws.data;
        const verified = verifyJwsCompact(jws, (keyid) =>
          keyid === clientKeyid ? clientPublicKey : undefined,
        );
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
