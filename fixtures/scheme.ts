import { join } from "node:path";
import type { Atom } from "@/fixtures/encoders";

/** Loaded fixture scheme modules for CSV → composite / decode. */
export type FixtureScheme = {
  version: string;
  taxonomy: readonly { axis: string }[];
  encoder: { compact(atoms: ReadonlyArray<Atom | null>): string };
  decoder: { decode(composite: string): Array<Atom | null> };
};

/**
 * Dynamic-import encoder, decoder, and taxonomy for `fixtures/<version>/`.
 */
export async function loadFixtureScheme(root: string, version: string): Promise<FixtureScheme> {
  const base = join(root, "fixtures", version);
  const encoderMod = await import(`${base}/encoder.ts`);
  const decoderMod = await import(`${base}/decoder.ts`);
  const taxonomyMod = await import(`${base}/taxonomy.ts`);
  return {
    version,
    taxonomy: taxonomyMod.taxonomy,
    encoder: encoderMod.encoder,
    decoder: decoderMod.decoder,
  };
}
