import { describe, expect, test } from "bun:test";
import { Pipeline } from "../pipeline";
import { buildCodebook, EMPTY_SYMBOL, toBase36 } from "../encoders";
import { encoder, encodeAtom, resolveAtom } from "./encoder";
import { decoder } from "./decoder";
import { encodingToCsvRow } from "./run";
import { classifyIntent, classifyShellFamily, knownAtoms, taxonomy } from "./taxonomy";
import type { Message } from "./message";

describe("classifyIntent", () => {
  test("matches first rule", () => {
    expect(classifyIntent("please plan this work")).toBe("plan");
    expect(classifyIntent("implement the cache")).toBe("implement");
    expect(classifyIntent("fix the null crash")).toBe("fix");
  });

  test("falls back to other", () => {
    expect(classifyIntent("hello there")).toBe("other");
  });
});

describe("classifyShellFamily", () => {
  test("detects known families", () => {
    expect(classifyShellFamily("git status")).toBe("git");
    expect(classifyShellFamily("bun test")).toBe("bun");
    expect(classifyShellFamily("bunx biome check")).toBe("bun");
    expect(classifyShellFamily("gh pr create")).toBe("gh");
  });

  test("falls back to other", () => {
    expect(classifyShellFamily("python script.py")).toBe("other");
    expect(classifyShellFamily(undefined)).toBe("other");
  });
});

describe("encoding", () => {
  test("base36 codebook uses trailing dot", () => {
    const book = buildCodebook(["a:1", "b:2"]);
    expect(book.get("a:1")).toBe(`${toBase36(0)}.`);
    expect(book.get("b:2")).toBe(`${toBase36(1)}.`);
  });

  test("compact yields one composite per row", () => {
    const atoms = [
      "who:user",
      "intent:other",
      ...Array(taxonomy.length - 2).fill(null),
    ];
    const composite = encoder.compact(atoms);
    expect(composite.startsWith(`${encodeAtom("who:user")}${encodeAtom("intent:other")}`)).toBe(
      true,
    );
    expect(composite.endsWith(EMPTY_SYMBOL.repeat(taxonomy.length - 2))).toBe(
      true,
    );
    expect(decoder.decode(composite)).toEqual(atoms);
  });

  test("unknown tool maps to tool:other", () => {
    expect(resolveAtom("tool:BrandNewTool")).toBe("tool:other");
  });

  test("knownAtoms cover every codebook entry", () => {
    for (const atom of knownAtoms) {
      expect(() => encodeAtom(atom)).not.toThrow();
    }
  });
});

describe("Pipeline", () => {
  test("csv row stores expanded axis values", () => {
    expect(
      encodingToCsvRow({
        atoms: [
          "who:agent",
          null,
          "kind:tool",
          "tool:Grep",
          ...Array(taxonomy.length - 4).fill(null),
        ],
      }),
    ).toBe(`agent,,tool,Grep${",".repeat(taxonomy.length - 4)}`);
  });

  test("processOne encodes a user message", async () => {
    const pipeline = new Pipeline(encoder);
    const encoding = await pipeline.processOne({
      kind: "user",
      who: "user",
      query: "please plan the migration",
    });
    expect(encoding.atoms).toEqual([
      "who:user",
      "intent:plan",
      ...Array(taxonomy.length - 2).fill(null),
    ]);
    expect(decoder.decode(encoder.compact(encoding.atoms))).toEqual(
      encoding.atoms,
    );
  });

  test("processOne encodes a shell tool call", async () => {
    const pipeline = new Pipeline(encoder);
    const encoding = await pipeline.processOne({
      kind: "agent",
      who: "agent",
      contentKind: "tool",
      toolName: "Shell",
      shellCommand: "git status",
    });
    expect(encoding.atoms).toEqual([
      "who:agent",
      null,
      "kind:tool",
      "tool:Shell",
      "sh:git",
      ...Array(taxonomy.length - 5).fill(null),
    ]);
    expect(decoder.decode(encoder.compact(encoding.atoms))).toEqual(
      encoding.atoms,
    );
  });

  test("feed yields encodings in order", async () => {
    const pipeline = new Pipeline(encoder);
    const messages: Message[] = [
      {
        kind: "session",
        model: "default",
        mode: "agent",
        force: "edit",
        max: "0",
      },
      { kind: "user", who: "user", query: "fix the bug" },
      { kind: "agent", who: "agent", contentKind: "text" },
    ];

    async function* source() {
      for (const m of messages) yield m;
    }

    const out: Array<Array<string | null>> = [];
    for await (const encoding of pipeline.feed(source())) {
      out.push(encoding.atoms);
    }

    const gap = (n: number) => Array<null>(n).fill(null);
    expect(out).toEqual([
      [...gap(6), "model:default", "mode:agent", "force:edit", "max:0"],
      ["who:user", "intent:fix", ...gap(8)],
      ["who:agent", null, "kind:text", ...gap(7)],
    ]);
  });
});
