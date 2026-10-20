/**
 * Ed25519 JWS Compact (RFC 7515) over caller-supplied bytes.
 * HTTP hops use RFC 9421; durable / WebSocket application payloads use this.
 */
import { sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { type MeshKeypair, publicKeyObject } from "./keys";

const b64url = (bytes: Buffer | Uint8Array): string => Buffer.from(bytes).toString("base64url");

const fromB64url = (value: string): Buffer | null => {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return null;
  }
};

export type SignJwsResult = {
  /** Compact JWS: base64url(header).base64url(payload).base64url(sig) */
  jws: string;
  kid: string;
};

export type VerifyJwsResult = { ok: true; kid: string } | { ok: false; error: string };

export type VerifyJwsCompactResult =
  | { ok: true; kid: string; payload: Uint8Array }
  | { ok: false; error: string };

/** Sign content bytes as EdDSA JWS Compact. */
export function signJws(content: Uint8Array, keypair: MeshKeypair): SignJwsResult {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "EdDSA", kid: keypair.keyid }), "utf8"));
  const payload = b64url(content);
  const signingInput = `${header}.${payload}`;
  const sig = cryptoSign(null, Buffer.from(signingInput, "utf8"), keypair.privateKey);
  return {
    jws: `${signingInput}.${b64url(sig)}`,
    kid: keypair.keyid,
  };
}

/** Verify Compact JWS was produced over exactly `content` with `publicKey`. */
export function verifyJws(content: Uint8Array, jws: string, publicKey: string): VerifyJwsResult {
  const parsed = verifyJwsCompact(jws, () => publicKey);
  if (!parsed.ok) return parsed;
  if (!Buffer.from(content).equals(parsed.payload)) {
    return { ok: false, error: "jws payload does not match content" };
  }
  return { ok: true, kid: parsed.kid };
}

/**
 * Parse and verify Compact JWS; return embedded payload bytes.
 * Used for WebSocket frames where the frame *is* the JWS.
 */
export function verifyJwsCompact(
  jws: string,
  lookupPublicKey: (keyid: string) => string | undefined,
): VerifyJwsCompactResult {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    return { ok: false, error: "jws must have three compact segments" };
  }
  const [headerB64, payloadB64, sigB64] = parts;
  if (!headerB64 || !payloadB64 || !sigB64) {
    return { ok: false, error: "jws segments must be non-empty" };
  }

  const headerJson = fromB64url(headerB64);
  if (headerJson === null) {
    return { ok: false, error: "invalid jws header encoding" };
  }
  let header: { alg?: unknown; kid?: unknown };
  try {
    header = JSON.parse(headerJson.toString("utf8")) as {
      alg?: unknown;
      kid?: unknown;
    };
  } catch {
    return { ok: false, error: "invalid jws header json" };
  }
  if (header.alg !== "EdDSA") {
    return { ok: false, error: `unsupported jws alg: ${String(header.alg)}` };
  }
  if (typeof header.kid !== "string" || header.kid.length === 0) {
    return { ok: false, error: "jws header missing kid" };
  }

  const payload = fromB64url(payloadB64);
  if (payload === null) {
    return { ok: false, error: "invalid jws payload encoding" };
  }

  const sig = fromB64url(sigB64);
  if (sig === null) {
    return { ok: false, error: "invalid jws signature encoding" };
  }
  if (sig.length !== 64) {
    return { ok: false, error: "invalid signature length" };
  }

  const publicKey = lookupPublicKey(header.kid);
  if (publicKey === undefined || publicKey.length === 0) {
    return { ok: false, error: `unknown keyid ${header.kid}` };
  }
  const key = publicKeyObject(publicKey);
  if (key === null) {
    return { ok: false, error: "invalid public key" };
  }

  const signingInput = `${headerB64}.${payloadB64}`;
  let ok = false;
  try {
    ok = cryptoVerify(null, Buffer.from(signingInput, "utf8"), key, sig);
  } catch {
    return { ok: false, error: "jws signature verification failed" };
  }
  if (!ok) return { ok: false, error: "jws signature verification failed" };
  return { ok: true, kid: header.kid, payload: new Uint8Array(payload) };
}
