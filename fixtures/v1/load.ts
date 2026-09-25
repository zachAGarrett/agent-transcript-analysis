import { homedir } from "node:os";
import { join } from "node:path";
import type { Message } from "./message";

const PROJECTS_ROOT = join(homedir(), ".cursor", "projects");

export type TranscriptFile = {
  id: string;
  path: string;
};

/** Parent transcript JSONL files (skips subagents/). */
export function listParentTranscripts(root = PROJECTS_ROOT): TranscriptFile[] {
  const out: TranscriptFile[] = [];
  const projects = Array.from(
    new Bun.Glob("*/agent-transcripts").scanSync({
      cwd: root,
      onlyFiles: false,
    }),
  );

  for (const projectRel of projects) {
    const base = join(root, projectRel);
    for (const entry of new Bun.Glob("*/*.jsonl").scanSync({
      cwd: base,
      onlyFiles: true,
    })) {
      if (entry.includes("/subagents/")) continue;
      const id = entry.split("/")[0];
      if (!id) continue;
      const filename = entry.split("/").pop() ?? "";
      if (filename !== `${id}.jsonl`) continue;
      out.push({ id, path: join(base, entry) });
    }
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

type JsonlContent =
  | { type: "text"; text?: string }
  | { type: "tool_use"; name?: string; input?: Record<string, unknown> };

type JsonlLine =
  | { role: "user" | "assistant"; message?: { content?: JsonlContent[] } }
  | { type: "turn_ended"; status?: string };

function extractUserQuery(text: string): string {
  const match = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return (match?.[1] ?? text).trim();
}

function shellCommandFromInput(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  const command = input.command;
  return typeof command === "string" ? command : undefined;
}

/** Yield normalized pipeline messages for one transcript, in order. */
export async function* messagesFromTranscript(path: string): AsyncGenerator<Message> {
  const file = Bun.file(path);
  const text = await file.text();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: JsonlLine;
    try {
      obj = JSON.parse(line) as JsonlLine;
    } catch {
      continue;
    }

    if ("type" in obj && obj.type === "turn_ended") {
      yield {
        kind: "turn_ended",
        who: "agent",
        status: obj.status ?? "other",
      };
      continue;
    }

    if (!("role" in obj) || !obj.message?.content) continue;

    if (obj.role === "user") {
      const textParts = obj.message.content
        .filter((c): c is { type: "text"; text?: string } => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      const query = extractUserQuery(textParts);
      if (!query) continue;
      yield { kind: "user", who: "user", query };
      continue;
    }

    if (obj.role === "assistant") {
      for (const block of obj.message.content) {
        if (block.type === "text") {
          yield { kind: "agent", who: "agent", contentKind: "text" };
        } else if (block.type === "tool_use") {
          yield {
            kind: "agent",
            who: "agent",
            contentKind: "tool",
            toolName: block.name ?? "other",
            shellCommand: shellCommandFromInput(block.input),
          };
        }
      }
    }
  }
}
