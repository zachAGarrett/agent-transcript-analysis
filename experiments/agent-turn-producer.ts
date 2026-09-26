import { join } from "node:path";
import { CsvProducer, type CsvProducerOptions } from "@/experiments/csv-producer";
import type { Producer, Sequence } from "@/experiments/producers";
import { type FixtureScheme, loadFixtureScheme } from "@/fixtures/scheme";

function whoOf(composite: string, decoder: FixtureScheme["decoder"]): "user" | "agent" | null {
  const atoms = decoder.decode(composite);
  for (const atom of atoms) {
    if (atom === "who:user") return "user";
    if (atom === "who:agent") return "agent";
  }
  return null;
}

function intentOf(composite: string, decoder: FixtureScheme["decoder"]): string | null {
  const atoms = decoder.decode(composite);
  for (const atom of atoms) {
    if (atom?.startsWith("intent:")) return atom.slice("intent:".length);
  }
  return null;
}

/**
 * Project a full-session sequence into agent-turn sequences.
 * Drops user rows (and any row without who); keeps preceding intent in meta.
 */
export function splitAgentTurns(session: Sequence, decoder: FixtureScheme["decoder"]): Sequence[] {
  const turns: Sequence[] = [];
  let intent: string | null = null;
  let agentSymbols: string[] = [];
  let turnIndex = 0;

  const flush = () => {
    if (agentSymbols.length === 0) return;
    turns.push({
      id: `${session.id}#${turnIndex}`,
      symbols: agentSymbols,
      meta: { intent },
    });
    turnIndex += 1;
    agentSymbols = [];
  };

  for (const symbol of session.symbols) {
    const who = whoOf(symbol, decoder);
    if (who === null) continue;
    if (who === "user") {
      flush();
      intent = intentOf(symbol, decoder);
      continue;
    }
    agentSymbols.push(symbol);
  }
  flush();
  return turns;
}

/**
 * Producer that yields one sequence per agent turn (patterns stay inside the turn).
 * Intent from the preceding user message is in `meta.intent`, not in `symbols`.
 */
export class AgentTurnProducer implements Producer {
  private readonly csv: CsvProducer;
  private readonly options: CsvProducerOptions;

  constructor(options: CsvProducerOptions) {
    this.options = options;
    this.csv = new CsvProducer(options);
  }

  async *sequences(): AsyncGenerator<Sequence> {
    const root = this.options.root ?? join(import.meta.dir, "..");
    const scheme = await loadFixtureScheme(root, this.options.fixtureVersion);
    for await (const session of this.csv.sequences()) {
      for (const turn of splitAgentTurns(session, scheme.decoder)) {
        yield turn;
      }
    }
  }
}
