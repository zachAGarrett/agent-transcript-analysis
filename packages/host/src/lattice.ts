import type { ILattice } from "@khoralabs/tkn";
import type { LatticePersistence, LatticeRef } from "./contracts";

/** Serialize async work so shared-lattice writers never overlap. */
function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return function runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = tail.then(() => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

async function openILattice(persistence: LatticePersistence): Promise<ILattice> {
  switch (persistence.kind) {
    case "sqlite": {
      const { Lattice } = await import("@khoralabs/tkn/bun-sqlite");
      return new Lattice({ filename: persistence.filename });
    }
    case "memory": {
      const { Lattice } = await import("@khoralabs/tkn/memory");
      return new Lattice();
    }
    case "turso": {
      throw new Error(
        "openLattice: turso persistence is async; use sqlite or memory with sync stream kernels",
      );
    }
    default: {
      const _exhaustive: never = persistence;
      throw new Error(`Unsupported lattice persistence: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export type OpenLatticeOptions = {
  id?: string;
};

/**
 * Open a lattice for the given persistence and attach a write mutex.
 * Turso lattices are async (`IAsyncLattice`); stream kernels currently expect sync `ILattice`
 * — prefer sqlite/memory for createStreamRunner until an async path exists.
 */
export async function openLattice(
  persistence: LatticePersistence,
  options?: OpenLatticeOptions,
): Promise<LatticeRef> {
  const lattice = await openILattice(persistence);
  const runExclusive = createMutex();
  return {
    id: options?.id,
    persistence,
    lattice,
    runExclusive,
    close() {
      lattice.close();
    },
  };
}
