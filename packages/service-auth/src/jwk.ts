import { decodePublicKey, encodePublicKey, type MeshKeypair } from "./keys";

/** Ed25519 public JWK as used in GNAP `client.key.jwk`. */
export type Ed25519PublicJwk = {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
  kid?: string;
};

export function publicJwkFromMeshKeypair(keypair: MeshKeypair): Ed25519PublicJwk {
  const raw = decodePublicKey(keypair.publicKey);
  if (raw === null) throw new Error("invalid mesh public key");
  return {
    kty: "OKP",
    crv: "Ed25519",
    x: raw.toString("base64url"),
    kid: keypair.keyid,
  };
}

export function multibaseFromPublicJwk(jwk: Ed25519PublicJwk): string | null {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
    return null;
  }
  try {
    const raw = Buffer.from(jwk.x, "base64url");
    if (raw.length !== 32) return null;
    return encodePublicKey(raw);
  } catch {
    return null;
  }
}

export function parseEd25519PublicJwk(value: unknown): Ed25519PublicJwk | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.kty !== "OKP" || obj.crv !== "Ed25519" || typeof obj.x !== "string") {
    return null;
  }
  const jwk: Ed25519PublicJwk = {
    kty: "OKP",
    crv: "Ed25519",
    x: obj.x,
  };
  if (typeof obj.kid === "string" && obj.kid.length > 0) {
    jwk.kid = obj.kid;
  }
  return jwk;
}
