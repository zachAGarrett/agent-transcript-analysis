/**
 * Normalized message shapes fed into the tagging pipeline.
 * Batch runners map Cursor transcript JSONL into these.
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
  toolName?: string;
  shellCommand?: string;
};

export type TurnEndedMessage = {
  kind: "turn_ended";
  who: "agent";
  status: string;
};
