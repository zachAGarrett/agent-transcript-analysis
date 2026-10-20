/** In-memory kid → multibase public key trust map. */

const keys = new Map<string, string>();

export function resetTrustStore(): void {
  keys.clear();
}

export function setTrustedPublicKey(keyid: string, publicKey: string): void {
  keys.set(keyid, publicKey);
}

export function setTrustedPublicKeys(map: Record<string, string>): void {
  for (const [keyid, publicKey] of Object.entries(map)) {
    if (typeof publicKey === "string" && publicKey.length > 0) {
      keys.set(keyid, publicKey);
    }
  }
}

export function lookupTrustedPublicKey(keyid: string): string | undefined {
  return keys.get(keyid);
}

/**
 * Load trust from env:
 * - WORKSTREAM_MESH_PUBLIC_KEYS: JSON object `{ "kid": "u…" }`
 * - WORKSTREAM_EMITTER_PUBLIC_KEY: single multibase key (kid `workstream-emitter`)
 */
export function loadTrustFromEnv(env: NodeJS.ProcessEnv = process.env): { loaded: number } {
  let loaded = 0;
  const json = env.WORKSTREAM_MESH_PUBLIC_KEYS?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, unknown>;
      for (const [keyid, value] of Object.entries(parsed)) {
        if (typeof value === "string" && value.length > 0) {
          keys.set(keyid, value);
          loaded += 1;
        }
      }
    } catch {
      throw new Error("WORKSTREAM_MESH_PUBLIC_KEYS must be valid JSON object");
    }
  }
  const single = env.WORKSTREAM_EMITTER_PUBLIC_KEY?.trim();
  if (single) {
    keys.set("workstream-emitter", single);
    loaded += 1;
  }
  return { loaded };
}
