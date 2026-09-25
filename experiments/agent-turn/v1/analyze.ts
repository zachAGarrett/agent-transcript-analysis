import type { Sequence } from "@/experiments/producers";
import type { ProducerSource } from "@/experiments/types";
import { UNIT_DELIMITER } from "@/fixtures/encoders";
import { decoder } from "@/fixtures/v1/decoder";
import { taxonomy } from "@/fixtures/v1/taxonomy";

export type DecodedPath = {
  id: string;
  intent: string | null;
  symbols: string[];
  tokens: string[];
};

export type MacroEntry = {
  token: string;
  length: number;
  count: number;
  hubScore?: number;
};

export type IntentMacroPair = {
  intent: string;
  macro: string;
  count: number;
};

export type DecoderAnalysis = {
  macrosByHub: MacroEntry[];
  macrosByFrequency: MacroEntry[];
  meanCompression: number;
  /** Share of macros that incorrectly contain who:user (should be ~0). */
  userAtomLeakShare: number;
  intentToMacros: IntentMacroPair[];
  examples: Array<{
    id: string;
    intent: string | null;
    symbolCount: number;
    tokenCount: number;
    macros: string[];
  }>;
};

export type AnalysisReport = {
  job: {
    latticeDb: string;
    trainCount: number;
    heldOutCount: number;
    producer: ProducerSource;
  };
  lattice: { vocabularySize: number };
  viterbi: DecoderAnalysis;
  beam: DecoderAnalysis;
  comparison: {
    topMacroJaccard: number;
    divergentSequenceCount: number;
  };
};

const COMPOSITE_WIDTH = taxonomy.length;

function unitParts(token: string): string[] {
  const units = token.split(UNIT_DELIMITER).filter((u) => u.length > 0);
  if (units.length === 0) {
    throw new Error(`Invalid token: ${token}`);
  }
  for (const unit of units) {
    const parts = unit.match(/(?:-|[0-9a-z]+)\./g);
    if (!parts || parts.join("") !== unit || parts.length !== COMPOSITE_WIDTH) {
      throw new Error(`Invalid token: ${token}`);
    }
  }
  return units;
}

export function tokenLength(token: string): number {
  return unitParts(token).length;
}

export function tokenToAtomSteps(token: string): Array<Array<string | null>> {
  return unitParts(token).map((unit) => decoder.decode(unit));
}

function hasUserAtom(atomSteps: Array<Array<string | null>>): boolean {
  return atomSteps.some((step) => step.includes("who:user"));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function analyzeDecoder(
  paths: DecodedPath[],
  hubScores: Map<string, number>,
  topK: number,
): DecoderAnalysis {
  const freq = new Map<string, number>();
  const intentMacro = new Map<string, number>();
  let macroOccurrences = 0;
  let userLeakOccurrences = 0;
  let compressionSum = 0;
  let compressionN = 0;

  for (const path of paths) {
    if (path.tokens.length > 0) {
      compressionSum += path.symbols.length / path.tokens.length;
      compressionN += 1;
    }
    for (const token of path.tokens) {
      let length: number;
      try {
        length = tokenLength(token);
      } catch {
        continue;
      }
      if (length <= 1) continue;
      macroOccurrences += 1;
      freq.set(token, (freq.get(token) ?? 0) + 1);
      const atoms = tokenToAtomSteps(token);
      if (hasUserAtom(atoms)) userLeakOccurrences += 1;
      if (path.intent) {
        const key = `${path.intent}\0${token}`;
        intentMacro.set(key, (intentMacro.get(key) ?? 0) + 1);
      }
    }
  }

  const toEntry = (token: string, count: number, hubScore?: number): MacroEntry => ({
    token,
    length: tokenLength(token),
    count,
    hubScore,
  });

  const macrosByFrequency = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topK)
    .map(([token, count]) => toEntry(token, count, hubScores.get(token)));

  const macrosByHub = [...hubScores.entries()]
    .filter(([token]) => {
      try {
        return tokenLength(token) > 1;
      } catch {
        return false;
      }
    })
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topK)
    .map(([token, hubScore]) => toEntry(token, freq.get(token) ?? 0, hubScore));

  const intentToMacros: IntentMacroPair[] = [...intentMacro.entries()]
    .map(([key, count]) => {
      const [intent, macro] = key.split("\0") as [string, string];
      return { intent, macro, count };
    })
    .sort((a, b) => b.count - a.count || a.intent.localeCompare(b.intent))
    .slice(0, topK);

  const examples = paths.slice(0, 5).map((path) => ({
    id: path.id,
    intent: path.intent,
    symbolCount: path.symbols.length,
    tokenCount: path.tokens.length,
    macros: path.tokens.filter((token) => {
      try {
        return tokenLength(token) > 1;
      } catch {
        return false;
      }
    }),
  }));

  return {
    macrosByHub,
    macrosByFrequency,
    meanCompression: compressionN === 0 ? 0 : compressionSum / compressionN,
    userAtomLeakShare: macroOccurrences === 0 ? 0 : userLeakOccurrences / macroOccurrences,
    intentToMacros,
    examples,
  };
}

export function analyze(args: {
  producer: ProducerSource;
  latticeDb: string;
  trainCount: number;
  heldOutCount: number;
  vocabularySize: number;
  hubTokens: Array<{ pattern: string; confidence: number }>;
  viterbiPaths: DecodedPath[];
  beamPaths: DecodedPath[];
  topK?: number;
}): AnalysisReport {
  const topK = args.topK ?? 25;
  const hubScores = new Map(args.hubTokens.map((h) => [h.pattern, h.confidence]));
  const viterbi = analyzeDecoder(args.viterbiPaths, hubScores, topK);
  const beam = analyzeDecoder(args.beamPaths, hubScores, topK);

  const vSet = new Set(viterbi.macrosByFrequency.map((m) => m.token));
  const bSet = new Set(beam.macrosByFrequency.map((m) => m.token));

  let divergent = 0;
  const beamById = new Map(args.beamPaths.map((p) => [p.id, p]));
  for (const vp of args.viterbiPaths) {
    const bp = beamById.get(vp.id);
    if (!bp) continue;
    if (vp.tokens.join("\0") !== bp.tokens.join("\0")) divergent += 1;
  }

  return {
    job: {
      latticeDb: args.latticeDb,
      trainCount: args.trainCount,
      heldOutCount: args.heldOutCount,
      producer: args.producer,
    },
    lattice: { vocabularySize: args.vocabularySize },
    viterbi,
    beam,
    comparison: {
      topMacroJaccard: jaccard(vSet, bSet),
      divergentSequenceCount: divergent,
    },
  };
}

export function printAnalysis(report: AnalysisReport): void {
  const fmtMacros = (entries: MacroEntry[]) =>
    entries
      .slice(0, 10)
      .map((m, i) => {
        const tools = tokenToAtomSteps(m.token)
          .map(
            (step) =>
              step.find((a) => a?.startsWith("tool:")) ??
              step.find((a) => a?.startsWith("kind:")) ??
              "-",
          )
          .join("→");
        return `  ${i + 1}. len=${m.length} count=${m.count} hub=${m.hubScore?.toFixed(4) ?? "-"} leak=${hasUserAtom(tokenToAtomSteps(m.token))} [${tools}]`;
      })
      .join("\n");

  const fmtPairs = (pairs: IntentMacroPair[]) =>
    pairs
      .slice(0, 10)
      .map((p, i) => `  ${i + 1}. intent=${p.intent} count=${p.count} len=${tokenLength(p.macro)}`)
      .join("\n");

  console.log(`vocabularySize=${report.lattice.vocabularySize}`);
  console.log(`train=${report.job.trainCount} heldOut=${report.job.heldOutCount}`);
  console.log(`latticeDb=${report.job.latticeDb}`);
  console.log("\n--- Viterbi macros by hub ---");
  console.log(fmtMacros(report.viterbi.macrosByHub) || "  (none)");
  console.log("\n--- Viterbi macros by frequency ---");
  console.log(fmtMacros(report.viterbi.macrosByFrequency) || "  (none)");
  console.log("\n--- Viterbi intent → macro ---");
  console.log(fmtPairs(report.viterbi.intentToMacros) || "  (none)");
  console.log(
    `\nViterbi compression=${report.viterbi.meanCompression.toFixed(3)} userAtomLeak=${report.viterbi.userAtomLeakShare.toFixed(3)}`,
  );
  console.log("\n--- Beam macros by frequency ---");
  console.log(fmtMacros(report.beam.macrosByFrequency) || "  (none)");
  console.log(
    `\ncomparison jaccard=${report.comparison.topMacroJaccard.toFixed(3)} divergent=${report.comparison.divergentSequenceCount}`,
  );
}

export function collectPaths(
  sequences: Sequence[],
  decode: (
    sequence: Sequence,
    options: { mode: "viterbi" } | { mode: "beam"; beamWidth: number },
  ) => string[],
  mode: "viterbi" | "beam",
): DecodedPath[] {
  return sequences.map((sequence) => ({
    id: sequence.id,
    intent: sequence.meta?.intent ?? null,
    symbols: sequence.symbols,
    tokens:
      mode === "viterbi"
        ? decode(sequence, { mode: "viterbi" })
        : decode(sequence, { mode: "beam", beamWidth: 32 }),
  }));
}
