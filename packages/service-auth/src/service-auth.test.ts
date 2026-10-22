import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildGrantRequestBody,
  issueOpenGrant,
  parseGnapAuthorization,
  verifyGrantRequest,
} from "./gnap";
import { MESH_SIGNATURE_SKEW_SEC, signHttpMessage, verifyHttpMessage } from "./http-signature";
import { multibaseFromPublicJwk, publicJwkFromMeshKeypair } from "./jwk";
import { signJws, verifyJws, verifyJwsCompact } from "./jws";
import { generateMeshKeypair, loadOrCreateMeshKeypair, parseMeshKeyJson } from "./keys";
import { TokenStore } from "./token";
import { lookupTrustedPublicKey, resetTrustStore, setTrustedPublicKey } from "./trust";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("jws", () => {
  test("sign and verify round-trip", () => {
    const kp = generateMeshKeypair("emitter");
    const content = new TextEncoder().encode(JSON.stringify({ op: "list", id: "1" }));
    const { jws } = signJws(content, kp);
    expect(verifyJws(content, jws, kp.publicKey)).toEqual({ ok: true, kid: "emitter" });
    const compact = verifyJwsCompact(jws, () => kp.publicKey);
    expect(compact.ok).toBe(true);
    if (compact.ok) {
      expect(Buffer.from(compact.payload).toString("utf8")).toBe(
        Buffer.from(content).toString("utf8"),
      );
    }
  });

  test("rejects tampered payload", () => {
    const kp = generateMeshKeypair("emitter");
    const content = new TextEncoder().encode("hello");
    const { jws } = signJws(content, kp);
    expect(verifyJws(new TextEncoder().encode("bye"), jws, kp.publicKey).ok).toBe(false);
  });

  test("rejects short signature without throwing", () => {
    const kp = generateMeshKeypair("emitter");
    const content = new TextEncoder().encode("hello");
    const { jws } = signJws(content, kp);
    const parts = jws.split(".");
    parts[2] = Buffer.from("short").toString("base64url");
    const result = verifyJwsCompact(parts.join("."), () => kp.publicKey);
    expect(result).toEqual({ ok: false, error: "invalid signature length" });
  });
});

describe("http-signature", () => {
  test("sign and verify GET upgrade-style request", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const { headers } = signHttpMessage({ method: "GET", url, keypair: kp });
    const result = verifyHttpMessage({
      method: "GET",
      url,
      headers,
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: true, keyid: "emitter" });
  });

  test("sign and verify POST with content-digest", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const body = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
    const { headers } = signHttpMessage({
      method: "POST",
      url,
      body,
      keypair: kp,
      headers: new Headers({ "content-type": "application/json" }),
    });
    expect(headers.get("content-digest")?.startsWith("sha-256=:")).toBe(true);
    const result = verifyHttpMessage({
      method: "POST",
      url,
      headers,
      body,
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: true, keyid: "emitter" });
  });

  test("rejects content-digest mismatch", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const body = new TextEncoder().encode("body-a");
    const { headers } = signHttpMessage({
      method: "POST",
      url,
      body,
      keypair: kp,
      headers: new Headers({ "content-type": "text/plain" }),
    });
    const result = verifyHttpMessage({
      method: "POST",
      url,
      headers,
      body: new TextEncoder().encode("body-b"),
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: false, error: "content-digest mismatch" });
  });

  test("rejects created outside skew window", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const now = Math.floor(Date.now() / 1000);
    const { headers } = signHttpMessage({
      method: "GET",
      url,
      keypair: kp,
      created: now - MESH_SIGNATURE_SKEW_SEC - 1,
    });
    const result = verifyHttpMessage({
      method: "GET",
      url,
      headers,
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
      nowSec: now,
    });
    expect(result).toEqual({ ok: false, error: "created outside skew window" });
  });

  test("rejects invalid url without throwing", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const { headers } = signHttpMessage({ method: "GET", url, keypair: kp });
    const result = verifyHttpMessage({
      method: "GET",
      url: "not a url",
      headers,
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: false, error: "invalid url" });
  });

  test("rejects body without content-digest coverage", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const { headers } = signHttpMessage({ method: "GET", url, keypair: kp });
    const result = verifyHttpMessage({
      method: "GET",
      url,
      headers,
      body: new TextEncoder().encode("smuggled"),
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: false, error: "body requires content-digest coverage" });
  });

  test("rejects short signature without throwing", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const { headers } = signHttpMessage({ method: "GET", url, keypair: kp });
    headers.set("signature", "sig1=:YQ==:");
    const result = verifyHttpMessage({
      method: "GET",
      url,
      headers,
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: false, error: "invalid signature bytes" });
  });

  test("rejects unknown keyid", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const { headers } = signHttpMessage({ method: "GET", url, keypair: kp });
    const result = verifyHttpMessage({
      method: "GET",
      url,
      headers,
      lookupPublicKey: () => undefined,
    });
    expect(result.ok).toBe(false);
  });
});

describe("keys", () => {
  test("loadOrCreateMeshKeypair persists and reloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "service-auth-"));
    tempDirs.push(dir);
    const filePath = join(dir, "emitter-ed25519.json");
    const first = loadOrCreateMeshKeypair(filePath, "workstream-emitter");
    const second = loadOrCreateMeshKeypair(filePath, "workstream-emitter");
    expect(second.keyid).toBe(first.keyid);
    expect(second.publicKey).toBe(first.publicKey);
    const fromFile = parseMeshKeyJson(readFileSync(filePath, "utf8"));
    expect(fromFile.keyid).toBe(first.keyid);
    expect(fromFile.publicKey).toBe(first.publicKey);
  });

  test("loadOrCreateMeshKeypair rejects missing privateKeyPkcs8", () => {
    const dir = mkdtempSync(join(tmpdir(), "service-auth-"));
    tempDirs.push(dir);
    const filePath = join(dir, "bad.json");
    writeFileSync(
      filePath,
      JSON.stringify({ keyid: "workstream-emitter", publicKey: "uAAAA" }),
      "utf8",
    );
    expect(() => loadOrCreateMeshKeypair(filePath, "workstream-emitter")).toThrow(
      /missing privateKeyPkcs8/,
    );
  });

  test("parseMeshKeyJson rejects non-string privateKeyPkcs8", () => {
    expect(() =>
      parseMeshKeyJson(JSON.stringify({ keyid: "a", publicKey: "uAAAA", privateKeyPkcs8: 1 })),
    ).toThrow(/missing publicKey\/privateKeyPkcs8/);
  });
});

describe("trust", () => {
  test("lookup after set", () => {
    resetTrustStore();
    setTrustedPublicKey("a", "uTEST");
    expect(lookupTrustedPublicKey("a")).toBe("uTEST");
    resetTrustStore();
    expect(lookupTrustedPublicKey("a")).toBeUndefined();
  });
});

describe("jwk", () => {
  test("round-trip mesh keypair to public JWK", () => {
    const kp = generateMeshKeypair("emitter");
    const jwk = publicJwkFromMeshKeypair(kp);
    expect(jwk.kty).toBe("OKP");
    expect(jwk.crv).toBe("Ed25519");
    expect(jwk.kid).toBe("emitter");
    expect(multibaseFromPublicJwk(jwk)).toBe(kp.publicKey);
  });
});

describe("gnap", () => {
  test("parseGnapAuthorization", () => {
    expect(parseGnapAuthorization("GNAP abc.def")).toBe("abc.def");
    expect(parseGnapAuthorization("gnap tok")).toBe("tok");
    expect(parseGnapAuthorization("Bearer x")).toBeNull();
    expect(parseGnapAuthorization(null)).toBeNull();
  });

  test("verifyGrantRequest accepts httpsig over embedded key", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/gnap";
    const bodyObj = buildGrantRequestBody(kp);
    const body = new TextEncoder().encode(JSON.stringify(bodyObj));
    const { headers } = signHttpMessage({
      method: "POST",
      url,
      body,
      keypair: kp,
      headers: new Headers({ "content-type": "application/json" }),
    });
    const result = verifyGrantRequest({ method: "POST", url, headers, body });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.keyid).toBe("emitter");
      expect(result.publicKey).toBe(kp.publicKey);
    }
  });

  test("verifyGrantRequest rejects mismatched signing key", () => {
    const presented = generateMeshKeypair("presented");
    const signer = generateMeshKeypair("signer");
    const url = "http://127.0.0.1:8787/gnap";
    const bodyObj = buildGrantRequestBody(presented);
    const body = new TextEncoder().encode(JSON.stringify(bodyObj));
    const { headers } = signHttpMessage({
      method: "POST",
      url,
      body,
      keypair: signer,
      headers: new Headers({ "content-type": "application/json" }),
    });
    const result = verifyGrantRequest({ method: "POST", url, headers, body });
    expect(result.ok).toBe(false);
  });

  test("TokenStore issues and expires tokens", () => {
    const store = new TokenStore();
    const kp = generateMeshKeypair("emitter");
    const issued = store.issue({
      publicKey: kp.publicKey,
      keyid: kp.keyid,
      access: [{ type: "workstream", actions: ["session"] }],
      expiresInSec: 10,
      nowSec: 1_000,
    });
    expect(store.lookup(issued.value, 1_005)?.keyid).toBe("emitter");
    expect(store.lookup(issued.value, 1_011)).toBeUndefined();
  });

  test("issueOpenGrant returns key-bound token", () => {
    const store = new TokenStore();
    const kp = generateMeshKeypair("emitter");
    const grant = issueOpenGrant(
      {
        ok: true,
        keyid: kp.keyid,
        publicKey: kp.publicKey,
        access: [{ type: "workstream", actions: ["session"] }],
      },
      store,
    );
    expect(grant.access_token.key).toBe(true);
    expect(store.lookup(grant.access_token.value)?.publicKey).toBe(kp.publicKey);
  });

  test("signHttpMessage covers authorization when present", () => {
    const kp = generateMeshKeypair("emitter");
    const url = "http://127.0.0.1:8787/ws";
    const { headers } = signHttpMessage({
      method: "GET",
      url,
      keypair: kp,
      headers: new Headers({ authorization: "GNAP tok" }),
    });
    expect(headers.get("signature-input")).toContain('"authorization"');
    const result = verifyHttpMessage({
      method: "GET",
      url,
      headers,
      lookupPublicKey: (id) => (id === kp.keyid ? kp.publicKey : undefined),
    });
    expect(result).toEqual({ ok: true, keyid: "emitter" });
  });
});
