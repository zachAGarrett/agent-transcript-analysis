import { Database } from "bun:sqlite";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";

/**
 * Persist hub scores via tkn's DegreeScorer (Lattice default).
 * Must open a writable Lattice — readonly skips scorer.compute.
 */
export function scoreLatticeDb(filename: string): { scored: number } {
  const lattice = new Lattice({ filename });
  try {
    lattice.getTopTokens(1);
  } finally {
    lattice.close();
  }
  const db = new Database(filename, { readonly: true });
  try {
    const row = db
      .query<{ n: number }, []>("SELECT count(*) n FROM nodes WHERE hub_score != 0")
      .get();
    return { scored: row?.n ?? 0 };
  } finally {
    db.close();
  }
}
