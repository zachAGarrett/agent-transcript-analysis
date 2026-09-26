import { describe, expect, test } from "bun:test";
import { buildCodebook, EMPTY_SYMBOL, toBase36, UNIT_DELIMITER } from "../encoders";
import { decoder } from "./decoder";
import { encodeAtom, encoder, resolveAtom } from "./encoder";
import { argmaxLabel, resolveChoiceLabel } from "./jev";
import { summarizeToolInput } from "./load";
import { classifyShellFamily, knownAtoms, taxonomy } from "./taxonomy";

describe("argmaxLabel / resolveChoiceLabel", () => {
  test("argmax picks highest probability", () => {
    expect(argmaxLabel({ explore: 0.2, edit: 0.7, other: 0.1 })).toBe("edit");
  });

  test("resolveChoiceLabel prefers argmax when choice disagrees", () => {
    expect(
      resolveChoiceLabel(
        { choice: "explore", probabilities: { explore: 0.3, edit: 0.6, other: 0.1 } },
        ["explore", "edit", "other"],
      ),
    ).toBe("edit");
  });

  test("resolveChoiceLabel falls back to choice without probabilities", () => {
    expect(resolveChoiceLabel({ choice: "plan" }, ["plan", "other"])).toBe("plan");
  });
});

describe("classifyShellFamily", () => {
  test("detects known families", () => {
    expect(classifyShellFamily("git status")).toBe("git");
    expect(classifyShellFamily("bun test")).toBe("bun");
    expect(classifyShellFamily("gh pr create")).toBe("gh");
  });
});

describe("summarizeToolInput", () => {
  test("summarizes Read path", () => {
    expect(summarizeToolInput("Read", { path: "/tmp/a.ts" })).toContain("path=");
  });

  test("summarizes Shell argv head", () => {
    expect(summarizeToolInput("Shell", { command: "bun test fixtures" })).toBe("bun test fixtures");
  });
});

describe("encoding", () => {
  test("base36 codebook uses trailing dot", () => {
    const book = buildCodebook(["a:1", "b:2"]);
    expect(book.get("a:1")).toBe(`${toBase36(0)}.`);
  });

  test("compact width matches taxonomy", () => {
    const atoms = ["who:user", "intent:other", ...Array(taxonomy.length - 2).fill(null)];
    const composite = encoder.compact(atoms);
    expect(composite.endsWith(UNIT_DELIMITER)).toBe(true);
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

  test("purpose atoms are in the codebook", () => {
    expect(resolveAtom("purpose:explore")).toBe("purpose:explore");
    expect(encodeAtom("purpose:edit").endsWith(".")).toBe(true);
  });

  test("csv structural row without calling Jev", () => {
    const atoms = ["who:agent", null, "purpose:explore", "kind:tool", "tool:Read", null, null];
    expect(atoms.length).toBe(taxonomy.length);
    expect(encoder.compact(atoms).includes(EMPTY_SYMBOL)).toBe(true);
  });
});
