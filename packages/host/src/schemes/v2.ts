import { type Atom, buildCodebook, EMPTY_SYMBOL, splitComposite } from "../symbols";
import { INTENT_LABELS, PURPOSE_LABELS } from "./labels";

export const V2_AXES = ["who", "intent", "purpose", "kind", "tool", "sh", "end"] as const;

export const V2_KNOWN_ATOMS: readonly string[] = [
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

const bySymbol = new Map<string, Atom>();
for (const [atom, symbol] of buildCodebook(V2_KNOWN_ATOMS)) {
  bySymbol.set(symbol, atom);
}

export function decodeV2Atom(symbol: string): Atom | null {
  const code = symbol.endsWith(".") ? symbol : `${symbol}.`;
  if (code === EMPTY_SYMBOL) return null;
  const atom = bySymbol.get(code);
  if (atom === undefined) throw new Error(`Unknown symbol ${symbol}`);
  return atom;
}

export function decodeV2(composite: string): Array<Atom | null> {
  const parts = splitComposite(composite);
  if (parts.length !== V2_AXES.length) {
    throw new Error(`Composite width ${parts.length} !== taxonomy width ${V2_AXES.length}`);
  }
  return parts.map(decodeV2Atom);
}
