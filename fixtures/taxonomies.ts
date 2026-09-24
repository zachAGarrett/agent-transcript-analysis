/** One axis in a taxonomy scheme. */
export type TaxonomyEntry<TMessage = unknown, TValue = string> = {
  /** Axis name, e.g. `who` or `intent`. */
  axis: string;
  /** Human-readable description of the axis. */
  description: string;
  /** Classify a message into this axis's value, or null when the axis does not apply. */
  classify: (message: TMessage) => Promise<TValue | null>;
};

/**
 * Run one taxonomy entry against one message.
 * Encoders parallelize this across every entry in a scheme.
 */
export async function classifyEntry<TMessage, TValue>(
  message: TMessage,
  entry: TaxonomyEntry<TMessage, TValue>,
): Promise<{ axis: string; value: TValue | null }> {
  const value = await entry.classify(message);
  return { axis: entry.axis, value };
}
