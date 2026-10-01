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

export function startService(options?: { port?: number; hostname?: string }) {
  const port = options?.port ?? DEFAULT_PORT;
  const hostname = options?.hostname ?? DEFAULT_HOST;

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
        let req: ClientRequest;
        try {
          const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
          const parsed: unknown = JSON.parse(text);
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
          ws.send(JSON.stringify({ id: "?", ok: false, error: "invalid JSON" }));
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
