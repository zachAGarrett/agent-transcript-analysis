/**
 * Normalized message shapes fed into the v2 tagging pipeline.
 * Extends v1 with text/tool payload fields for Jev Choice state.
 */
export type Message = UserMessage | AgentMessage | TurnEndedMessage;

export type UserMessage = {
  kind: "user";
  who: "user";
  query: string;
};

export type AgentMessage = {
  kind: "agent";
  who: "agent";
  contentKind: "text" | "tool";
  /** Assistant text block body (text rows only). */
  agentText?: string;
  toolName?: string;
  shellCommand?: string;
  /** Compact, non-secret sketch of tool args for classifiers. */
  toolInputSummary?: string;
};

export type TurnEndedMessage = {
  kind: "turn_ended";
  who: "agent";
  status: string;
};
