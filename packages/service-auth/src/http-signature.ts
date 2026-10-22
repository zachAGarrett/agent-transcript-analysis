/**
 * RFC 9421 HTTP Message Signatures (ed25519) + RFC 9530 Content-Digest.
 * Used to authenticate the WebSocket HTTP upgrade request.
 */
import { createHash, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { type MeshKeypair, publicKeyObject } from "./keys";

/** Reject signatures whose `created` is outside this many seconds. */
export const MESH_SIGNATURE_SKEW_SEC = 60;

export type HeaderGetter = {
  get(name: string): string | null;
};

export type VerifyHttpMessageInput = {
  method: string;
  url: string;
  headers: HeaderGetter;
  body?: Uint8Array | null;
  lookupPublicKey: (keyid: string) => string | undefined;
  nowSec?: number;
};

export type VerifyHttpMessageResult = { ok: true; keyid: string } | { ok: false; error: string };

function contentDigestValue(body: Uint8Array): string {
  const digest = createHash("sha256").update(body).digest();
  return `sha-256=:${digest.toString("base64")}:`;
}

function authorityOf(url: URL): string {
  return url.host;
}

function queryComponent(url: URL): string {
  return url.search.length > 0 ? url.search : "?";
}

function coveredComponents(hasBody: boolean, hasAuthorization: boolean): string[] {
  const base = hasBody
    ? ["@method", "@path", "@query", "@authority", "content-digest", "content-type"]
    : ["@method", "@path", "@query", "@authority"];
  if (hasAuthorization) {
    return [...base, "authorization"];
  }
  return base;
}

function signatureParams(components: readonly string[], created: number, keyid: string): string {
  const list = components.map((item) => `"${item}"`).join(" ");
  return `(${list});created=${created};keyid="${keyid}";alg="ed25519"`;
}

function componentValue(
  name: string,
  url: URL,
  method: string,
  headers: HeaderGetter,
): string | null {
  switch (name) {
    case "@method":
      return method.toUpperCase();
    case "@path":
      return url.pathname.length > 0 ? url.pathname : "/";
    case "@query":
      return queryComponent(url);
    case "@authority":
      return authorityOf(url);
    default:
      return headers.get(name);
  }
}

function signatureBase(
  components: readonly string[],
  params: string,
  url: URL,
  method: string,
  headers: HeaderGetter,
): string | null {
  const lines: string[] = [];
  for (const name of components) {
    const value = componentValue(name, url, method, headers);
    if (value === null) return null;
    lines.push(`"${name}": ${value}`);
  }
  lines.push(`"@signature-params": ${params}`);
  return lines.join("\n");
}

function bodyBytes(body: Uint8Array | null | undefined): Uint8Array | null {
  if (body === null || body === undefined || body.byteLength === 0) return null;
  return body;
}

export function signHttpMessage(input: {
  method: string;
  url: string;
  headers?: Headers;
  body?: Uint8Array | null;
  keypair: MeshKeypair;
  created?: number;
}): { headers: Headers } {
  const url = new URL(input.url);
  const headers = new Headers(input.headers);
  const body = bodyBytes(input.body);
  const created = input.created ?? Math.floor(Date.now() / 1000);
  if (body !== null) {
    headers.set("content-digest", contentDigestValue(body));
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  const hasAuthorization = headers.has("authorization");
  const components = coveredComponents(body !== null, hasAuthorization);
  const params = signatureParams(components, created, input.keypair.keyid);
  const base = signatureBase(components, params, url, input.method, headers);
  if (base === null) {
    throw new Error("cannot sign: missing covered header");
  }
  const sig = cryptoSign(null, Buffer.from(base, "utf8"), input.keypair.privateKey);
  headers.set("signature-input", `sig1=${params}`);
  headers.set("signature", `sig1=:${Buffer.from(sig).toString("base64")}:`);
  return { headers };
}

function parseInnerList(params: string): string[] | null {
  const match = /^\(([^)]*)\)/.exec(params);
  if (match === null) return null;
  const inner = match[1]?.trim() ?? "";
  if (inner.length === 0) return [];
  const names: string[] = [];
  for (const part of inner.split(/\s+/)) {
    const item = /^"([^"]+)"$/.exec(part);
    if (item === null || item[1] === undefined) return null;
    names.push(item[1]);
  }
  return names;
}

function parseParam(params: string, name: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${name}=(?:"([^"]*)"|([^;]+))`);
  const match = re.exec(params);
  if (match === null) return null;
  return (match[1] ?? match[2] ?? "").trim();
}

function parseByteSequence(value: string): Buffer | null {
  const match = /^:([A-Za-z0-9+/=]*):$/.exec(value.trim());
  if (match === null || match[1] === undefined) return null;
  try {
    return Buffer.from(match[1], "base64");
  } catch {
    return null;
  }
}

export function verifyHttpMessage(input: VerifyHttpMessageInput): VerifyHttpMessageResult {
  const signatureInput = input.headers.get("signature-input")?.trim() ?? "";
  const signatureHeader = input.headers.get("signature")?.trim() ?? "";
  const inputMatch = /^sig1=(.+)$/.exec(signatureInput);
  const sigMatch = /^sig1=(.+)$/.exec(signatureHeader);
  if (inputMatch === null || sigMatch === null) {
    return { ok: false, error: "missing RFC 9421 signature" };
  }
  const params = inputMatch[1] ?? "";
  const components = parseInnerList(params);
  if (components === null || components.length === 0) {
    return { ok: false, error: "invalid signature-input" };
  }
  const keyid = parseParam(params, "keyid");
  const alg = parseParam(params, "alg");
  const createdRaw = parseParam(params, "created");
  if (keyid === null || alg !== "ed25519" || createdRaw === null) {
    return { ok: false, error: "unsupported signature params" };
  }
  const created = Number(createdRaw);
  if (!Number.isFinite(created)) {
    return { ok: false, error: "invalid created" };
  }
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - created) > MESH_SIGNATURE_SKEW_SEC) {
    return { ok: false, error: "created outside skew window" };
  }
  const body = bodyBytes(input.body);
  if (body !== null && !components.includes("content-digest")) {
    return { ok: false, error: "body requires content-digest coverage" };
  }
  if (components.includes("content-digest")) {
    if (body === null) {
      return { ok: false, error: "content-digest requires body bytes" };
    }
    if (!components.includes("content-type")) {
      return { ok: false, error: "body must be covered by content-type" };
    }
    const digest = input.headers.get("content-digest")?.trim() ?? "";
    if (digest !== contentDigestValue(body)) {
      return { ok: false, error: "content-digest mismatch" };
    }
  }
  const publicKey = input.lookupPublicKey(keyid);
  if (publicKey === undefined || publicKey.length === 0) {
    return { ok: false, error: `unknown keyid ${keyid}` };
  }
  const key = publicKeyObject(publicKey);
  if (key === null) {
    return { ok: false, error: "invalid public key" };
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  const base = signatureBase(components, params, url, input.method, input.headers);
  if (base === null) {
    return { ok: false, error: "missing covered component" };
  }
  const sig = parseByteSequence(sigMatch[1] ?? "");
  if (sig === null || sig.length !== 64) {
    return { ok: false, error: "invalid signature bytes" };
  }
  let ok = false;
  try {
    ok = cryptoVerify(null, Buffer.from(base, "utf8"), key, sig);
  } catch {
    return { ok: false, error: "bad signature" };
  }
  if (!ok) return { ok: false, error: "bad signature" };
  return { ok: true, keyid };
}

export type MeshIncomingRequest = {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
  clone(): { arrayBuffer(): Promise<ArrayBuffer> };
};

async function bodyFromIncoming(req: MeshIncomingRequest): Promise<Uint8Array | null> {
  try {
    const buf = await req.clone().arrayBuffer();
    return buf.byteLength === 0 ? null : new Uint8Array(buf);
  } catch {
    return null;
  }
}

export async function verifyRequest(
  req: MeshIncomingRequest,
  lookupPublicKey: (keyid: string) => string | undefined,
  nowSec?: number,
): Promise<VerifyHttpMessageResult> {
  const body = await bodyFromIncoming(req);
  return verifyHttpMessage({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body,
    lookupPublicKey,
    nowSec,
  });
}
