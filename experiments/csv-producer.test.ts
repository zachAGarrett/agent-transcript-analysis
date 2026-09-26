import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSequence } from "@/experiments/csv-producer";
import type { FixtureScheme } from "@/fixtures/scheme";
import { decoder as v1Decoder } from "@/fixtures/v1/decoder";
import { encoder as v1Encoder } from "@/fixtures/v1/encoder";
import { taxonomy as v1Taxonomy } from "@/fixtures/v1/taxonomy";
import { decoder as v2Decoder } from "@/fixtures/v2/decoder";
import { encoder as v2Encoder } from "@/fixtures/v2/encoder";
import { taxonomy as v2Taxonomy } from "@/fixtures/v2/taxonomy";

const v1Scheme: FixtureScheme = {
  version: "v1",
  taxonomy: v1Taxonomy,
  encoder: v1Encoder,
  decoder: v1Decoder,
};

const v2Scheme: FixtureScheme = {
  version: "v2",
  taxonomy: v2Taxonomy,
  encoder: v2Encoder,
  decoder: v2Decoder,
};

describe("loadSequence fixture scheme", () => {
  test("v2 header keeps purpose width on round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-csv-"));
    const file = join(dir, "t.csv");
    await writeFile(
      file,
      ["who,intent,purpose,kind,tool,sh,end", "user,fix,,,,,,", "agent,,explore,tool,Read,,"].join(
        "\n",
      ),
    );
    const sequence = await loadSequence(file, v2Scheme);
    expect(sequence.symbols).toHaveLength(2);
    for (const symbol of sequence.symbols) {
      expect(v2Decoder.decode(symbol)).toHaveLength(v2Taxonomy.length);
    }
    const agentSymbol = sequence.symbols[1];
    if (agentSymbol === undefined) throw new Error("expected agent symbol");
    const agent = v2Decoder.decode(agentSymbol);
    expect(agent).toContain("purpose:explore");
  });

  test("v1 scheme rejects v2 header", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-csv-"));
    const file = join(dir, "t.csv");
    await writeFile(file, ["who,intent,purpose,kind,tool,sh,end", "user,fix,,,,,,"].join("\n"));
    await expect(loadSequence(file, v1Scheme)).rejects.toThrow(/CSV header mismatch/);
  });
});
