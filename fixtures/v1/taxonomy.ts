import type { TaxonomyEntry } from "../taxonomies";
import type { Message } from "./message";

export type { Message } from "./message";

/**
 * v1 taxonomy axes. Order is the step column order.
 * Classifiers return null when the axis does not apply to the message.
 */
export const taxonomy: readonly TaxonomyEntry<Message>[] = [
  {
    axis: "who",
    description: "Speaker of the message: user or agent.",
    async classify(message) {
      if (message.kind === "session") return null;
      return message.who;
    },
  },
  {
    axis: "intent",
    description:
      "User intent from the query text: plan, implement, fix, refactor, explain, review, test, or other.",
    async classify(message) {
      if (message.kind !== "user") return null;
      return classifyIntent(message.query);
    },
  },
  {
    axis: "kind",
    description: "Agent content kind: text or tool.",
    async classify(message) {
      if (message.kind !== "agent") return null;
      return message.contentKind;
    },
  },
  {
    axis: "tool",
    description: "Tool name when the agent content is a tool call.",
    async classify(message) {
      if (message.kind !== "agent" || message.contentKind !== "tool") return null;
      return message.toolName ?? "other";
    },
  },
  {
    axis: "sh",
    description: "Shell command family: git, bun, gh, or other.",
    async classify(message) {
      if (
        message.kind !== "agent" ||
        message.contentKind !== "tool" ||
        message.toolName !== "Shell"
      ) {
        return null;
      }
      return classifyShellFamily(message.shellCommand);
    },
  },
  {
    axis: "end",
    description: "Turn-ended status when the event is a turn boundary.",
    async classify(message) {
      if (message.kind !== "turn_ended") return null;
      return message.status;
    },
  },
  {
    axis: "model",
    description: "Session model name from composerData.modelConfig.modelName.",
    async classify(message) {
      if (message.kind !== "session") return null;
      return message.model;
    },
  },
  {
    axis: "mode",
    description: "Session unifiedMode: agent, plan, or chat.",
    async classify(message) {
      if (message.kind !== "session") return null;
      return message.mode;
    },
  },
  {
    axis: "force",
    description: "Session forceMode from composerData.",
    async classify(message) {
      if (message.kind !== "session") return null;
      return message.force;
    },
  },
  {
    axis: "max",
    description: "Session maxMode flag as 0 or 1.",
    async classify(message) {
      if (message.kind !== "session") return null;
      return message.max;
    },
  },
];

const INTENT_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "plan", pattern: /\b(plan|design|architect|spec)\b/i },
  { label: "implement", pattern: /\b(implement|add|create|build|write)\b/i },
  { label: "fix", pattern: /\b(fix|bug|broken|error|fail|issue)\b/i },
  { label: "refactor", pattern: /\b(refactor|rename|restructure|cleanup|clean up)\b/i },
  { label: "explain", pattern: /\b(explain|how does|what is|why|describe)\b/i },
  { label: "review", pattern: /\b(review|audit|check|look at)\b/i },
  { label: "test", pattern: /\b(test|spec|coverage|assert)\b/i },
];

export function classifyIntent(query: string): string {
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(query)) return rule.label;
  }
  return "other";
}

export function classifyShellFamily(command: string | undefined): string {
  if (!command) return "other";
  const first = command.trim().split(/\s+/)[0] ?? "";
  const base = first.split("/").pop() ?? first;
  if (base === "git") return "git";
  if (base === "bun" || base === "bunx") return "bun";
  if (base === "gh") return "gh";
  return "other";
}

/** Closed set of atoms known to v1 (used to build the codebook). */
export const knownAtoms: readonly string[] = [
  "who:user",
  "who:agent",
  "intent:plan",
  "intent:implement",
  "intent:fix",
  "intent:refactor",
  "intent:explain",
  "intent:review",
  "intent:test",
  "intent:other",
  "kind:text",
  "kind:tool",
  "tool:Read",
  "tool:Grep",
  "tool:Glob",
  "tool:Write",
  "tool:StrReplace",
  "tool:Delete",
  "tool:Shell",
  "tool:Task",
  "tool:TodoWrite",
  "tool:CreatePlan",
  "tool:Await",
  "tool:AskQuestion",
  "tool:EditNotebook",
  "tool:WebSearch",
  "tool:WebFetch",
  "tool:SwitchMode",
  "tool:CallDynamicTool",
  "tool:GetDynamicTools",
  "tool:FetchMcpResource",
  "tool:ConnectScm",
  "tool:other",
  "sh:git",
  "sh:bun",
  "sh:gh",
  "sh:other",
  "end:success",
  "end:error",
  "end:cancelled",
  "end:other",
  "model:default",
  "model:gpt-5.6-sol",
  "model:claude-opus-5",
  "model:claude-sonnet-5",
  "model:grok-4.6",
  "model:grok-4.7",
  "model:composer-2.5",
  "model:other",
  "mode:agent",
  "mode:plan",
  "mode:chat",
  "mode:other",
  "force:edit",
  "force:chat",
  "force:other",
  "max:0",
  "max:1",
];
