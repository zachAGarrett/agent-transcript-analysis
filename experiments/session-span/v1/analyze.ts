import type { Sequence } from "@/experiments/producers";
import type { ProducerSource } from "@/experiments/types";
import { UNIT_DELIMITER } from "@/fixtures/encoders";
import { decoder } from "@/fixtures/v1/decoder";
import { taxonomy } from "@/fixtures/v1/taxonomy";

export type DecodedPath = {
  id: string;
  symbols: string[];
  tokens: string[];
};

export type MacroEntry = {
  token: string;
  length: number;
  count: number;
  hubScore?: number;
  crossesTurn: boolean;
};

export type DecoderAnalysis = {
  macrosByHub: MacroEntry[];
  macrosByFrequency: MacroEntry[];
  crossTurnShare: number;
  meanCompression: number;
  examples: Array<{
    id: string;
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

/** Number of composites (steps) covered by a concatenated vocabulary token. */
export function tokenLength(token: string): number {
  return unitParts(token).length;
}

/** Expand a (possibly multi-step) token into one atom vector per step. */
export function tokenToAtomSteps(token: string): Array<Array<string | null>> {
  return unitParts(token).map((unit) => decoder.decode(unit));
}

export function crossesTurn(atomSteps: Array<Array<string | null>>): boolean {
  let hasUser = false;
  let hasAgent = false;
  for (const step of atomSteps) {
    for (const atom of step) {
      if (atom === "who:user") hasUser = true;
      if (atom === "who:agent") hasAgent = true;
    }
  }
  return hasUser && hasAgent;
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
  exampleLimit: number,
): DecoderAnalysis {
  const freq = new Map<string, number>();
  let macroOccurrences = 0;
  let crossTurnOccurrences = 0;
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
      if (crossesTurn(atoms)) crossTurnOccurrences += 1;
    }
  }

  const toEntry = (token: string, count: number, hubScore?: number): MacroEntry => ({
    token,
    length: tokenLength(token),
    count,
    hubScore,
    crossesTurn: crossesTurn(tokenToAtomSteps(token)),
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

  const examples = paths.slice(0, exampleLimit).map((path) => ({
    id: path.id,
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
    crossTurnShare: macroOccurrences === 0 ? 0 : crossTurnOccurrences / macroOccurrences,
    meanCompression: compressionN === 0 ? 0 : compressionSum / compressionN,
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

  const viterbi = analyzeDecoder(args.viterbiPaths, hubScores, topK, 5);
  const beam = analyzeDecoder(args.beamPaths, hubScores, topK, 5);

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

/** Pretty-print the analysis summary for the smoke gate / CLI. */
export function printAnalysis(report: AnalysisReport): void {
  const fmt = (entries: MacroEntry[]) =>
    entries
      .slice(0, 10)
      .map((m, i) => {
        const who = tokenToAtomSteps(m.token)
          .map((step) => step.find((a) => a?.startsWith("who:")) ?? "-")
          .join("→");
        return `  ${i + 1}. len=${m.length} count=${m.count} hub=${m.hubScore?.toFixed(4) ?? "-"} cross=${m.crossesTurn} [${who}]`;
      })
      .join("\n");

  console.log(`vocabularySize=${report.lattice.vocabularySize}`);
  console.log(`train=${report.job.trainCount} heldOut=${report.job.heldOutCount}`);
  console.log(`latticeDb=${report.job.latticeDb}`);
  console.log("\n--- Viterbi macros by hub ---");
  console.log(fmt(report.viterbi.macrosByHub) || "  (none)");
  console.log("\n--- Viterbi macros by frequency ---");
  console.log(fmt(report.viterbi.macrosByFrequency) || "  (none)");
  console.log(
    `\nViterbi crossTurnShare=${report.viterbi.crossTurnShare.toFixed(3)} compression=${report.viterbi.meanCompression.toFixed(3)}`,
  );
  console.log("\n--- Beam macros by hub ---");
  console.log(fmt(report.beam.macrosByHub) || "  (none)");
  console.log("\n--- Beam macros by frequency ---");
  console.log(fmt(report.beam.macrosByFrequency) || "  (none)");
  console.log(
    `\nBeam crossTurnShare=${report.beam.crossTurnShare.toFixed(3)} compression=${report.beam.meanCompression.toFixed(3)}`,
  );
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
    symbols: sequence.symbols,
    tokens:
      mode === "viterbi"
        ? decode(sequence, { mode: "viterbi" })
        : decode(sequence, { mode: "beam", beamWidth: 32 }),
  }));
}
