import {
  type MeshIncomingRequest,
  signHttpMessage,
  type VerifyHttpMessageResult,
  verifyHttpMessage,
} from "./http-signature";
import {
  type Ed25519PublicJwk,
  multibaseFromPublicJwk,
  parseEd25519PublicJwk,
  publicJwkFromMeshKeypair,
} from "./jwk";
import type { MeshKeypair } from "./keys";
import {
  defaultTokenStore,
  type GnapAccess,
  type IssuedAccessToken,
  type TokenStore,
} from "./token";

/** Fixed access descriptor for workstream WS sessions. */
export const WORKSTREAM_SESSION_ACCESS: GnapAccess[] = [
  { type: "workstream", actions: ["session"] },
];

export type GnapClientKey = {
  proof: "httpsig";
  jwk: Ed25519PublicJwk;
};

export type GnapGrantRequestBody = {
  access_token: {
    access: GnapAccess[];
  };
  client: {
    key: GnapClientKey;
  };
};

export type GnapGrantResponse = {
  access_token: IssuedAccessToken;
};

export function parseGnapAuthorization(header: string | null): string | null {
  if (header === null) return null;
  const match = /^GNAP\s+(\S+)\s*$/i.exec(header.trim());
  if (match === null || match[1] === undefined) return null;
  return match[1];
}

export function buildGrantRequestBody(keypair: MeshKeypair): GnapGrantRequestBody {
  return {
    access_token: { access: WORKSTREAM_SESSION_ACCESS },
    client: {
      key: {
        proof: "httpsig",
        jwk: publicJwkFromMeshKeypair(keypair),
      },
    },
  };
}

export type ParsedGrantClient = {
  keyid: string;
  publicKey: string;
  jwk: Ed25519PublicJwk;
};

export function parseGrantClientKey(body: unknown): ParsedGrantClient | { error: string } {
  if (!body || typeof body !== "object") {
    return { error: "invalid grant body" };
  }
  const client = (body as { client?: unknown }).client;
  if (!client || typeof client !== "object") {
    return { error: "missing client" };
  }
  const key = (client as { key?: unknown }).key;
  if (!key || typeof key !== "object") {
    return { error: "missing client.key" };
  }
  const proof = (key as { proof?: unknown }).proof;
  if (proof !== "httpsig") {
    return { error: "client.key.proof must be httpsig" };
  }
  const jwk = parseEd25519PublicJwk((key as { jwk?: unknown }).jwk);
  if (jwk === null) {
    return { error: "invalid client.key.jwk" };
  }
  const publicKey = multibaseFromPublicJwk(jwk);
  if (publicKey === null) {
    return { error: "invalid client.key.jwk.x" };
  }
  const keyid =
    typeof jwk.kid === "string" && jwk.kid.length > 0 ? jwk.kid : publicKey.slice(0, 16);
  return { keyid, publicKey, jwk };
}

export type VerifyGrantResult =
  | { ok: true; keyid: string; publicKey: string; access: GnapAccess[] }
  | { ok: false; error: string };

/**
 * Verify a GNAP grant request: parse embedded client key, verify httpsig against it.
 */
export function verifyGrantRequest(input: {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
  body: Uint8Array;
  nowSec?: number;
}): VerifyGrantResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.body)) as unknown;
  } catch {
    return { ok: false, error: "invalid grant JSON" };
  }

  const client = parseGrantClientKey(parsed);
  if ("error" in client) {
    return { ok: false, error: client.error };
  }

  const accessRaw = (parsed as { access_token?: { access?: unknown } }).access_token?.access;
  if (!Array.isArray(accessRaw) || accessRaw.length === 0) {
    return { ok: false, error: "missing access_token.access" };
  }

  const verified = verifyHttpMessage({
    method: input.method,
    url: input.url,
    headers: input.headers,
    body: input.body,
    nowSec: input.nowSec,
    lookupPublicKey: (id) => (id === client.keyid ? client.publicKey : undefined),
  });
  if (!verified.ok) {
    return { ok: false, error: verified.error };
  }
  if (verified.keyid !== client.keyid) {
    return { ok: false, error: "signature keyid mismatch" };
  }

  return {
    ok: true,
    keyid: client.keyid,
    publicKey: client.publicKey,
    access: WORKSTREAM_SESSION_ACCESS,
  };
}

export async function verifyGrantIncoming(
  req: MeshIncomingRequest,
  nowSec?: number,
): Promise<VerifyGrantResult> {
  let body: Uint8Array;
  try {
    const buf = await req.clone().arrayBuffer();
    body = new Uint8Array(buf);
  } catch {
    return { ok: false, error: "unreadable body" };
  }
  if (body.byteLength === 0) {
    return { ok: false, error: "empty body" };
  }
  return verifyGrantRequest({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
    nowSec,
  });
}

/** Open-policy grant: issue a key-bound token after successful verification. */
export function issueOpenGrant(
  verified: Extract<VerifyGrantResult, { ok: true }>,
  store: TokenStore = defaultTokenStore,
  expiresInSec?: number,
): GnapGrantResponse {
  const access_token = store.issue({
    publicKey: verified.publicKey,
    keyid: verified.keyid,
    access: verified.access,
    expiresInSec,
  });
  return { access_token };
}

/** Client helper: POST /gnap with signed body; returns access token value. */
export async function requestGnapAccessToken(input: {
  grantUrl: string;
  keypair: MeshKeypair;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const bodyObj = buildGrantRequestBody(input.keypair);
  const bodyText = JSON.stringify(bodyObj);
  const bodyBytes = new TextEncoder().encode(bodyText);
  const { headers } = signHttpMessage({
    method: "POST",
    url: input.grantUrl,
    body: bodyBytes,
    keypair: input.keypair,
    headers: new Headers({ "content-type": "application/json" }),
  });
  const fetchFn = input.fetchImpl ?? fetch;
  const res = await fetchFn(input.grantUrl, {
    method: "POST",
    headers,
    body: bodyText,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GNAP grant failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { access_token?: { value?: unknown } };
  const value = json.access_token?.value;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("GNAP grant response missing access_token.value");
  }
  return value;
}

export function grantUrlFromWsUrl(wsUrl: string): string {
  let http = wsUrl;
  if (wsUrl.startsWith("ws://")) http = `http://${wsUrl.slice("ws://".length)}`;
  else if (wsUrl.startsWith("wss://")) http = `https://${wsUrl.slice("wss://".length)}`;
  const url = new URL(http);
  url.pathname = "/gnap";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export type { VerifyHttpMessageResult };
