import { decodeV1, V1_AXES } from "./v1";
import { decodeV2, V2_AXES } from "./v2";

export type PatternScheme = {
  axes: readonly string[];
  decode: (composite: string) => Array<string | null>;
};

/** Width-keyed schemes for explorer pattern label decode. */
export const PATTERN_SCHEMES: readonly PatternScheme[] = [
  { axes: V2_AXES, decode: decodeV2 },
  { axes: V1_AXES, decode: decodeV1 },
];

export function schemeForWidth(width: number): PatternScheme | undefined {
  return PATTERN_SCHEMES.find((scheme) => scheme.axes.length === width);
}

export {
  INTENT_CRITERIA,
  INTENT_LABELS,
  type IntentLabel,
  PURPOSE_CRITERIA,
  PURPOSE_LABELS,
  type PurposeLabel,
} from "./labels";
export type {
  AgentMessage,
  Message,
  TurnEndedMessage,
  UserMessage,
} from "./messages";
export { decodeV1, decodeV1Atom, V1_AXES, V1_KNOWN_ATOMS } from "./v1";
export { decodeV2, decodeV2Atom, V2_AXES, V2_KNOWN_ATOMS } from "./v2";
