import { describe, expect, test } from "bun:test";
import { splitAgentTurns } from "@/experiments/agent-turn-producer";
import type { Sequence } from "@/experiments/producers";
import { encoder } from "@/fixtures/v1/encoder";

function compact(partial: Record<string, string>): string {
  const atoms = [
    partial.who ? `who:${partial.who}` : null,
    partial.intent ? `intent:${partial.intent}` : null,
    partial.kind ? `kind:${partial.kind}` : null,
    partial.tool ? `tool:${partial.tool}` : null,
    null,
    null,
  ];
  return encoder.compact(atoms);
}

describe("splitAgentTurns", () => {
  test("drops user rows; keeps intent in meta", () => {
    const session: Sequence = {
      id: "sess",
      symbols: [
        compact({ who: "user", intent: "plan" }),
        compact({ who: "agent", kind: "text" }),
        compact({ who: "agent", kind: "tool", tool: "Read" }),
        compact({ who: "user", intent: "fix" }),
        compact({ who: "agent", kind: "tool", tool: "Shell" }),
      ],
    };

    const turns = splitAgentTurns(session);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.meta?.intent).toBe("plan");
    expect(turns[0]?.symbols).toHaveLength(2);
    expect(turns[1]?.meta?.intent).toBe("fix");
    expect(turns[1]?.symbols).toHaveLength(1);
    expect(turns[0]?.id).toBe("sess#0");
    expect(turns[1]?.id).toBe("sess#1");
  });
});
