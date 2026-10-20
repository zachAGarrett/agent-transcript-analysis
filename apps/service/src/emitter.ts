import {
  type MeshKeypair,
  signHttpMessage,
  signJws,
  type VerifyHttpMessageResult,
} from "@workstream/service-auth";
import type { ServerReply } from "./session";

export type EmitterEvent = {
  type: "event";
  streamId: string;
  event: unknown;
};

export type EmitterConnectOptions = {
  url: string;
  keypair: MeshKeypair;
  /** Called for each server `type:"event"` message. */
  onEvent?: (event: EmitterEvent) => void;
  /** Per-request timeout in ms (default 30_000). */
  requestTimeoutMs?: number;
};

type Pending = {
  resolve: (reply: ServerReply) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

function toHttpUrl(wsUrl: string): string {
  if (wsUrl.startsWith("ws://")) return `http://${wsUrl.slice("ws://".length)}`;
  if (wsUrl.startsWith("wss://")) return `https://${wsUrl.slice("wss://".length)}`;
  return wsUrl;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Signed WebSocket client: owns upgrade signing, JWS request frames, and reply demux.
 * Stream `event` messages are delivered only via `onEvent` (no per-request correlation).
 */
export class Emitter {
  readonly url: string;
  readonly keypair: MeshKeypair;
  private ws: WebSocket;
  private onEvent?: (event: EmitterEvent) => void;
  private requestTimeoutMs: number;
  private closed = false;
  private readonly pending = new Map<string, Pending>();

  private constructor(
    url: string,
    keypair: MeshKeypair,
    ws: WebSocket,
    onEvent: ((event: EmitterEvent) => void) | undefined,
    requestTimeoutMs: number,
  ) {
    this.url = url;
    this.keypair = keypair;
    this.ws = ws;
    this.onEvent = onEvent;
    this.requestTimeoutMs = requestTimeoutMs;
    this.ws.addEventListener("message", (ev) => this.onMessage(ev));
    this.ws.addEventListener("error", (ev) => this.rejectAll(ev));
    this.ws.addEventListener("close", () => this.rejectAll(new Error("WebSocket closed")));
  }

  static async connect(options: EmitterConnectOptions): Promise<Emitter> {
    const httpUrl = toHttpUrl(options.url);
    const { headers } = signHttpMessage({
      method: "GET",
      url: httpUrl,
      keypair: options.keypair,
    });
    // Bun's WebSocket accepts `{ headers }` for the upgrade; DOM typings do not.
    const BunWebSocket = WebSocket as unknown as {
      new (url: string, init?: { headers?: Record<string, string> }): WebSocket;
    };
    const ws = new BunWebSocket(options.url, { headers: headersToRecord(headers) });
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
        reject(new Error("WebSocket closed before open (check upgrade auth)"));
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
    return new Emitter(
      options.url,
      options.keypair,
      ws,
      options.onEvent,
      options.requestTimeoutMs ?? 30_000,
    );
  }

  private onMessage(ev: MessageEvent): void {
    let msg: {
      id?: string;
      type?: string;
      ok?: boolean;
      error?: string;
      streamId?: string;
      event?: unknown;
    };
    try {
      msg = JSON.parse(String(ev.data)) as typeof msg;
    } catch (error) {
      this.rejectAll(error);
      return;
    }

    if (msg.type === "event") {
      this.onEvent?.({
        type: "event",
        streamId: String(msg.streamId ?? ""),
        event: msg.event,
      });
      return;
    }

    if (msg.id === "?" && msg.ok === false) {
      this.rejectAll(new Error(msg.error ?? "protocol error"));
      return;
    }

    if (typeof msg.id === "string") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      pending.resolve(msg as ServerReply);
    }
  }

  private rejectAll(reason: unknown): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(reason);
      this.pending.delete(id);
    }
  }

  /**
   * Send a signed ClientRequest; wait for the matching reply.
   * Intermediate `type:"event"` messages are forwarded only to `onEvent`.
   */
  async request(body: { op: string; id?: string } & Record<string, unknown>): Promise<ServerReply> {
    if (this.closed) throw new Error("Emitter is closed");
    const id = body.id ?? crypto.randomUUID();
    const req = { ...body, id };
    const content = new TextEncoder().encode(JSON.stringify(req));
    const { jws } = signJws(content, this.keypair);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Emitter.request timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(jws);
    });
  }

  /** Test/helper: send a raw WebSocket frame (unsigned). */
  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error("Emitter is closed"));
    this.ws.close();
  }
}

export type { VerifyHttpMessageResult };
