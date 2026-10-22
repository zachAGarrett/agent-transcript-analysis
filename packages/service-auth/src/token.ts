import { randomBytes } from "node:crypto";

export type GnapAccess = {
  type: string;
  actions: string[];
};

export type AccessTokenRecord = {
  publicKey: string;
  keyid: string;
  expiresAt: number;
  access: GnapAccess[];
};

export type IssuedAccessToken = {
  value: string;
  access: GnapAccess[];
  /** Key-bound per RFC 9635 §3.2.1. */
  key: true;
  expires_in: number;
};

const DEFAULT_EXPIRES_IN_SEC = 3600;

export class TokenStore {
  private readonly tokens = new Map<string, AccessTokenRecord>();

  issue(input: {
    publicKey: string;
    keyid: string;
    access: GnapAccess[];
    expiresInSec?: number;
    nowSec?: number;
  }): IssuedAccessToken {
    const expiresInSec = input.expiresInSec ?? DEFAULT_EXPIRES_IN_SEC;
    const nowSec = input.nowSec ?? Math.floor(Date.now() / 1000);
    const value = randomBytes(32).toString("base64url");
    this.tokens.set(value, {
      publicKey: input.publicKey,
      keyid: input.keyid,
      expiresAt: nowSec + expiresInSec,
      access: input.access,
    });
    return {
      value,
      access: input.access,
      key: true,
      expires_in: expiresInSec,
    };
  }

  lookup(value: string, nowSec = Math.floor(Date.now() / 1000)): AccessTokenRecord | undefined {
    const record = this.tokens.get(value);
    if (!record) return undefined;
    if (record.expiresAt <= nowSec) {
      this.tokens.delete(value);
      return undefined;
    }
    return record;
  }

  clear(): void {
    this.tokens.clear();
  }
}

/** Shared in-memory store for the colocated AS/RS (tests may call clear). */
export const defaultTokenStore = new TokenStore();
