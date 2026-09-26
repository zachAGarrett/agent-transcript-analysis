import type { TaxonomyEntry } from "../taxonomies";
import { classifyIntentWithJev, classifyPurposeWithJev } from "./jev";
import { INTENT_LABELS, PURPOSE_LABELS } from "./labels";
import type { Message } from "./message";

/**
 * v2 taxonomy axes. Order is the CSV column order.
 * Structural axes are deterministic; intent/purpose call Jev Choice.
 */
export const taxonomy: readonly TaxonomyEntry<Message>[] = [
  {
    axis: "who",
    description: "Speaker of the message: user or agent.",
    async classify(message) {
      return message.who;
    },
  },
  {
    axis: "intent",
    description:
      "User intent via Jev Choice: plan, implement, fix, refactor, explain, review, test, or other.",
    async classify(message) {
      if (message.kind !== "user") return null;
      const result = await classifyIntentWithJev(message);
      return result.label;
    },
  },
  {
    axis: "purpose",
    description:
      "Agent step purpose via Jev Choice: explore, edit, verify, plan, ask, narrate, or other.",
    async classify(message) {
      if (message.kind !== "agent") return null;
      const result = await classifyPurposeWithJev(message);
      return result.label;
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
];

export function classifyShellFamily(command: string | undefined): string {
  if (!command) return "other";
  const first = command.trim().split(/\s+/)[0] ?? "";
  const base = first.split("/").pop() ?? first;
  if (base === "git") return "git";
  if (base === "bun" || base === "bunx") return "bun";
  if (base === "gh") return "gh";
  return "other";
}

/** Closed set of atoms known to v2 (used to build the codebook). */
export const knownAtoms: readonly string[] = [
  "who:user",
  "who:agent",
  ...INTENT_LABELS.map((label) => `intent:${label}`),
  ...PURPOSE_LABELS.map((label) => `purpose:${label}`),
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
];
