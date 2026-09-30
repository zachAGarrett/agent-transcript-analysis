import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lattice } from "@khoralabs/tkn/bun-sqlite";
import type { Atom, Encoder, Encoding } from "@/fixtures/encoders";
import { replayMessages } from "./replay";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type FakeMessage = { tag: string | null };

function fakeEncoder(): Encoder<FakeMessage> {
  return {
    taxonomy: [{ axis: "tag", description: "t", classify: async (m) => m.tag }],
    encodeAtom(atom: Atom) {
      return `${atom.split(":")[1] ?? atom}.`;
    },
    async encode(message: FakeMessage): Promise<Encoding> {
      return { atoms: [message.tag === null ? null : `tag:${message.tag}`] };
    },
    compact(atoms: ReadonlyArray<Atom | null>) {
      return `${atoms.map((a) => (a === null ? "-." : `${a.split(":")[1]}.`)).join("")}|`;
    },
  };
}

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("replayMessages", () => {
  test("writes lattice.db, events.jsonl, report.json; skips all-null encodings", async () => {
    const parent = mkdtempSync(join(tmpdir(), "wt-replay-"));
    dirs.push(parent);
    const outDir = join(parent, "job");

    const result = await replayMessages({
      messages: fromArray<FakeMessage>([{ tag: "a" }, { tag: null }, { tag: "b" }, { tag: "a" }]),
      encoder: fakeEncoder(),
      outDir,
      artifactRel: {
        latticeDb: "runtime/v1/runs/job/lattice.db",
        eventsJsonl: "runtime/v1/runs/job/events.jsonl",
      },
      fixtureVersion: "v1",
      transcriptId: "fake-transcript",
      concurrency: 2,
    });

    expect(result.symbolCount).toBe(3);
    expect(result.report.kind).toBe("runtime-replay");
    expect(result.report.job.symbolCount).toBe(3);
    expect(result.report.job.transcriptId).toBe("fake-transcript");
    expect(result.report.job.commitBatchSize).toBe(10);

    const report = await Bun.file(join(outDir, "report.json")).json();
    expect(report.kind).toBe("runtime-replay");
    expect(report.job.symbolCount).toBe(3);

    const eventsText = await Bun.file(join(outDir, "events.jsonl")).text();
    const events = eventsText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.some((e) => e.kind === "tagged")).toBe(true);
    expect(events.some((e) => e.kind === "decoded")).toBe(true);
    expect(events.at(-1)).toMatchObject({ kind: "sessionEnded", symbolCount: 3 });

    const decoded = events.filter((e) => e.kind === "decoded");
    expect(decoded.map((e) => e.symbolCount)).toEqual([1, 2, 3]);
    expect(decoded.every((e) => e.snapshot === undefined)).toBe(true);
    expect(decoded.every((e) => Array.isArray(e.steps))).toBe(true);
    const tagged = events.filter((e) => e.kind === "tagged");
    expect(tagged.map((e) => e.symbol)).toEqual(["a.|", "b.|", "a.|"]);

    const latticePath = join(outDir, "lattice.db");
    expect(await Bun.file(latticePath).exists()).toBe(true);
    const lattice = new Lattice({ filename: latticePath });
    try {
      const vocab = lattice.vocabulary();
      expect(vocab).toContain("a.|");
      expect(vocab).toContain("b.|");
    } finally {
      lattice.close();
    }
  });

  test("closes events writer when the message stream fails", async () => {
    const parent = mkdtempSync(join(tmpdir(), "wt-replay-fail-"));
    dirs.push(parent);
    const outDir = join(parent, "job");

    async function* failingMessages(): AsyncGenerator<FakeMessage> {
      yield { tag: "a" };
      throw new Error("stream-boom");
    }

    let threw = false;
    try {
      await replayMessages({
        messages: failingMessages(),
        encoder: fakeEncoder(),
        outDir,
        artifactRel: {
          latticeDb: "runtime/v1/runs/job/lattice.db",
          eventsJsonl: "runtime/v1/runs/job/events.jsonl",
        },
        fixtureVersion: "v1",
        transcriptId: "fail-transcript",
        concurrency: 1,
      });
    } catch (error) {
      threw = true;
      expect((error as Error).message).toBe("stream-boom");
    }
    expect(threw).toBe(true);

    const eventsPath = join(outDir, "events.jsonl");
    expect(await Bun.file(eventsPath).exists()).toBe(true);
    // Writer finalized: file is readable after the failure path.
    const text = await Bun.file(eventsPath).text();
    expect(text.length).toBeGreaterThan(0);
  });
});
