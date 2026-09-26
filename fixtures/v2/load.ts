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

/** Truncate long strings for classifier state (never store secrets wholesale). */
function clip(value: string, max = 240): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/**
 * Build a compact, non-secret sketch of tool args for purpose classification.
 * Prefer path/glob/pattern families over full file bodies or env dumps.
 */
export function summarizeToolInput(
  toolName: string | undefined,
  input: Record<string, unknown> | undefined,
): string | undefined {
  if (!input || Object.keys(input).length === 0) return undefined;
  const name = toolName ?? "other";

  if (name === "Shell") {
    const cmd = shellCommandFromInput(input);
    if (!cmd) return undefined;
    const tokens = cmd.trim().split(/\s+/).slice(0, 6);
    return clip(tokens.join(" "));
  }

  const parts: string[] = [];
  for (const key of ["path", "target_directory", "glob_pattern", "pattern", "url", "command"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) {
      parts.push(`${key}=${clip(v, 120)}`);
    }
  }
  if (name === "StrReplace" || name === "Write") {
    if (typeof input.path === "string") parts.push(`path=${clip(input.path, 120)}`);
    if (typeof input.old_string === "string") parts.push("has_old_string");
    if (typeof input.new_string === "string" || typeof input.contents === "string") {
      parts.push("has_write_body");
    }
  }
  if (name === "Grep") {
    if (typeof input.path === "string") parts.push(`path=${clip(input.path, 80)}`);
    if (typeof input.glob === "string") parts.push(`glob=${clip(input.glob, 80)}`);
  }
  if (parts.length === 0) {
    const keys = Object.keys(input).slice(0, 6);
    return clip(`keys=${keys.join(",")}`);
  }
  return clip(parts.join(" "));
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
          const agentText = (block.text ?? "").trim();
          if (!agentText) continue;
          yield {
            kind: "agent",
            who: "agent",
            contentKind: "text",
            agentText,
          };
        } else if (block.type === "tool_use") {
          const toolName = block.name ?? "other";
          yield {
            kind: "agent",
            who: "agent",
            contentKind: "tool",
            toolName,
            shellCommand: shellCommandFromInput(block.input),
            toolInputSummary: summarizeToolInput(toolName, block.input),
          };
        }
      }
    }
  }
}
