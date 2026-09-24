/**
 * Normalized message shapes fed into the tagging pipeline.
 * Batch runners map Cursor JSONL + composerData into these.
 */
export type Message =
  | SessionMessage
  | UserMessage
  | AgentMessage
  | TurnEndedMessage;

export type SessionMessage = {
  kind: "session";
  model: string;
  mode: string;
  force: string;
  max: "0" | "1";
};

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
