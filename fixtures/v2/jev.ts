import {
  INTENT_CRITERIA,
  INTENT_LABELS,
  type IntentLabel,
  PURPOSE_CRITERIA,
  PURPOSE_LABELS,
  type PurposeLabel,
} from "./labels";
import type { AgentMessage, UserMessage } from "./message";

/** Jev list price (AI Gateway); used for estimated $ even when billed as free. */
export const JEV_INPUT_USD_PER_MILLION = 0.042;
export const JEV_OUTPUT_USD_PER_MILLION = 0;
export const JEV_MODEL = "typesafe-ai/jev";

const SYSTEMONE_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";

export type JevCallMetrics = {
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
};

export type IntentClassification = {
  axis: "intent";
  label: IntentLabel;
  probabilities?: Record<string, number>;
  metrics: JevCallMetrics;
};

export type PurposeClassification = {
  axis: "purpose";
  label: PurposeLabel;
  probabilities?: Record<string, number>;
  metrics: JevCallMetrics;
};

type ChoiceAnswer = {
  type?: string;
  choice?: string;
  probabilities?: Record<string, number>;
};

type SystemOneResponse = {
  answers?: Record<string, ChoiceAnswer>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
};

function estimatedUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000 +
    (outputTokens * JEV_OUTPUT_USD_PER_MILLION) / 1_000_000
  );
}

/** Pick the label with the highest probability (ties → first max). */
export function argmaxLabel(
  probabilities: Record<string, number> | undefined,
  fallback = "other",
): string {
  if (!probabilities) return fallback;
  let best = fallback;
  let bestP = -Infinity;
  for (const [label, p] of Object.entries(probabilities)) {
    if (typeof p !== "number" || !Number.isFinite(p)) continue;
    if (p > bestP) {
      bestP = p;
      best = label;
    }
  }
  return bestP === -Infinity ? fallback : best;
}

/**
 * Resolve a Choice answer. Prefer argmax over `choice` when probabilities disagree
 * with the reported selection (AI SDK rejects that case; we keep going).
 */
export function resolveChoiceLabel(
  answer: ChoiceAnswer | undefined,
  allowed: readonly string[],
): string {
  const fallback = answer?.choice && allowed.includes(answer.choice) ? answer.choice : "other";
  const picked = argmaxLabel(answer?.probabilities, fallback);
  return allowed.includes(picked) ? picked : "other";
}

function assertIntent(label: string): IntentLabel {
  if ((INTENT_LABELS as readonly string[]).includes(label)) return label as IntentLabel;
  return "other";
}

function assertPurpose(label: string): PurposeLabel {
  if ((PURPOSE_LABELS as readonly string[]).includes(label)) return label as PurposeLabel;
  return "other";
}

function usageFromResponse(usage: SystemOneResponse["usage"]): {
  inputTokens: number;
  outputTokens: number;
} {
  return {
    inputTokens: usage?.input_tokens ?? usage?.inputTokens ?? 0,
    outputTokens: usage?.output_tokens ?? usage?.outputTokens ?? 0,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function systemOneChoice(params: {
  state: unknown;
  questionId: string;
  instructions: { question: string; focus: string };
  criteria: Record<string, unknown>;
  maxRetries?: number;
}): Promise<{
  answer: ChoiceAnswer;
  metrics: Omit<JevCallMetrics, "estimatedUsd"> & { estimatedUsd: number };
}> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is required for Jev classification");

  const maxRetries = params.maxRetries ?? 5;
  const started = performance.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(SYSTEMONE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: JEV_MODEL,
          state: params.state,
          questions: {
            [params.questionId]: {
              type: "choice",
              instructions: params.instructions,
              criteria: params.criteria,
            },
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        if (isRetryableStatus(response.status) && attempt < maxRetries) {
          await sleep(Math.min(30_000, 500 * 2 ** attempt));
          continue;
        }
        throw new Error(`Jev systemone ${response.status}: ${body.slice(0, 400)}`);
      }

      const payload = (await response.json()) as SystemOneResponse;
      const answer = payload.answers?.[params.questionId] ?? {};
      const tokens = usageFromResponse(payload.usage);
      return {
        answer,
        metrics: {
          latencyMs: performance.now() - started,
          ...tokens,
          estimatedUsd: estimatedUsd(tokens.inputTokens, tokens.outputTokens),
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const transient =
        lastError.name === "TimeoutError" ||
        /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(lastError.message);
      if (transient && attempt < maxRetries) {
        await sleep(Math.min(30_000, 500 * 2 ** attempt));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("Jev systemone failed after retries");
}

/** Shared state object for a user intent Choice. */
export function intentState(message: UserMessage) {
  return {
    role: "user" as const,
    query: message.query,
  };
}

/** Shared state object for an agent purpose Choice. */
export function purposeState(message: AgentMessage) {
  if (message.contentKind === "text") {
    return {
      role: "agent" as const,
      contentKind: "text" as const,
      text: message.agentText ?? "",
    };
  }
  return {
    role: "agent" as const,
    contentKind: "tool" as const,
    toolName: message.toolName ?? "other",
    shellCommand: message.shellCommand ?? null,
    toolInputSummary: message.toolInputSummary ?? null,
  };
}

/** Classify user intent via one Jev Choice question. */
export async function classifyIntentWithJev(message: UserMessage): Promise<IntentClassification> {
  const { answer, metrics } = await systemOneChoice({
    state: intentState(message),
    questionId: "intent",
    instructions: {
      question: "What is the primary user intent of this coding-agent request?",
      focus: "Pick one primary label; prefer other when none fit clearly.",
    },
    criteria: INTENT_CRITERIA,
  });
  return {
    axis: "intent",
    label: assertIntent(resolveChoiceLabel(answer, INTENT_LABELS)),
    probabilities: answer.probabilities,
    metrics,
  };
}

/** Classify agent purpose via one Jev Choice question. */
export async function classifyPurposeWithJev(
  message: AgentMessage,
): Promise<PurposeClassification> {
  const { answer, metrics } = await systemOneChoice({
    state: purposeState(message),
    questionId: "purpose",
    instructions: {
      question: "What is the primary purpose of this agent step?",
      focus: "Classify the step itself (tool or text), not the broader user goal.",
    },
    criteria: PURPOSE_CRITERIA,
  });
  return {
    axis: "purpose",
    label: assertPurpose(resolveChoiceLabel(answer, PURPOSE_LABELS)),
    probabilities: answer.probabilities,
    metrics,
  };
}
