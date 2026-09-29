import type { Sequence } from "./producers";

/** Session id for split grouping: strip agent-turn `#N` suffix when present. */
export function sessionIdOf(sequence: Sequence): string {
  const hash = sequence.id.lastIndexOf("#");
  if (hash > 0 && /^\d+$/.test(sequence.id.slice(hash + 1))) {
    return sequence.id.slice(0, hash);
  }
  return sequence.id;
}

/** Mulberry32 — deterministic seeded shuffle. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(items: T[], rand: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

export type SessionSplit = {
  seed: number;
  holdoutPct: number;
  trainSessionIds: string[];
  holdoutSessionIds: string[];
  train: Sequence[];
  holdout: Sequence[];
};

/**
 * Split sequences by unique session id so turns from one transcript
 * cannot appear in both train and holdout.
 */
export function splitBySession(
  sequences: Sequence[],
  options: { holdoutPct: number; seed: number },
): SessionSplit {
  const { holdoutPct, seed } = options;
  if (!(holdoutPct > 0 && holdoutPct < 100)) {
    throw new Error(`holdoutPct must be in (0, 100), got ${holdoutPct}`);
  }

  const bySession = new Map<string, Sequence[]>();
  for (const sequence of sequences) {
    const sid = sessionIdOf(sequence);
    const list = bySession.get(sid);
    if (list) list.push(sequence);
    else bySession.set(sid, [sequence]);
  }

  const sessionIds = [...bySession.keys()].sort();
  const rand = mulberry32(seed);
  shuffleInPlace(sessionIds, rand);

  const holdoutCount = Math.max(1, Math.floor((sessionIds.length * holdoutPct) / 100));
  const holdoutSessionIds = sessionIds.slice(0, holdoutCount).sort();
  const holdoutSet = new Set(holdoutSessionIds);
  const trainSessionIds = sessionIds.filter((id) => !holdoutSet.has(id)).sort();

  const train: Sequence[] = [];
  const holdout: Sequence[] = [];
  for (const id of trainSessionIds) {
    for (const sequence of bySession.get(id) ?? []) train.push(sequence);
  }
  for (const id of holdoutSessionIds) {
    for (const sequence of bySession.get(id) ?? []) holdout.push(sequence);
  }

  if (train.length === 0) {
    throw new Error("Train split is empty; lower holdoutPct or add more sessions");
  }

  return {
    seed,
    holdoutPct,
    trainSessionIds,
    holdoutSessionIds,
    train,
    holdout,
  };
}
