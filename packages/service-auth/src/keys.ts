import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type MeshKeypair = {
  keyid: string;
  /** Multibase `u…` public key. */
  publicKey: string;
  privateKey: KeyObject;
};

type StoredKeypair = {
  keyid: string;
  publicKey: string;
  privateKeyPkcs8: string;
};

function rawPublicKey(key: KeyObject): Buffer {
  const spki = key.export({ type: "spki", format: "der" });
  return Buffer.from(spki).subarray(-32);
}

export function encodePublicKey(raw32: Buffer): string {
  return `u${raw32.toString("base64url")}`;
}

export function decodePublicKey(multibase: string): Buffer | null {
  const value = multibase.trim();
  if (!value.startsWith("u") || value.length < 2) return null;
  try {
    const raw = Buffer.from(value.slice(1), "base64url");
    return raw.length === 32 ? raw : null;
  } catch {
    return null;
  }
}

export function publicKeyObject(multibase: string): KeyObject | null {
  const raw = decodePublicKey(multibase);
  if (raw === null) return null;
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: "der",
    type: "spki",
  });
}

export function generateMeshKeypair(keyid: string): MeshKeypair {
  const pair = generateKeyPairSync("ed25519");
  return {
    keyid,
    publicKey: encodePublicKey(rawPublicKey(pair.publicKey)),
    privateKey: pair.privateKey,
  };
}

export function parseMeshKeyJson(json: string): MeshKeypair {
  const trimmed = json.trim();
  if (trimmed.length === 0) throw new Error("mesh key JSON is empty");
  const stored = JSON.parse(trimmed) as StoredKeypair;
  if (typeof stored.keyid !== "string" || stored.keyid.length === 0) {
    throw new Error("mesh key JSON is missing keyid");
  }
  if (typeof stored.publicKey !== "string" || typeof stored.privateKeyPkcs8 !== "string") {
    throw new Error("mesh key JSON is missing publicKey/privateKeyPkcs8");
  }
  return {
    keyid: stored.keyid,
    publicKey: stored.publicKey,
    privateKey: createPrivateKey({
      key: Buffer.from(stored.privateKeyPkcs8, "base64"),
      format: "der",
      type: "pkcs8",
    }),
  };
}

export function loadOrCreateMeshKeypair(filePath: string, keyid: string): MeshKeypair {
  if (existsSync(filePath)) {
    const stored = JSON.parse(readFileSync(filePath, "utf8")) as StoredKeypair;
    if (stored.keyid !== keyid || typeof stored.publicKey !== "string") {
      throw new Error(`mesh keypair at ${filePath} does not match keyid ${keyid}`);
    }
    if (typeof stored.privateKeyPkcs8 !== "string") {
      throw new Error(`mesh keypair at ${filePath} is missing privateKeyPkcs8`);
    }
    return {
      keyid,
      publicKey: stored.publicKey,
      privateKey: createPrivateKey({
        key: Buffer.from(stored.privateKeyPkcs8, "base64"),
        format: "der",
        type: "pkcs8",
      }),
    };
  }
  const generated = generateMeshKeypair(keyid);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const pkcs8 = generated.privateKey.export({ type: "pkcs8", format: "der" });
  const stored: StoredKeypair = {
    keyid,
    publicKey: generated.publicKey,
    privateKeyPkcs8: Buffer.from(pkcs8).toString("base64"),
  };
  writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return generated;
}
