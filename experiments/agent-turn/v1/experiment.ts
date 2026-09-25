import {
  type AnalysisReport,
  analyze,
  collectPaths,
  printAnalysis,
} from "@/experiments/agent-turn/v1/analyze";
import { AgentTurnProducer } from "@/experiments/agent-turn-producer";
import type { ExperimentDefinition } from "@/experiments/types";

export const experiment: ExperimentDefinition = {
  name: "agent-turn",
  version: "v1",
  createProducer({ paths }) {
    return new AgentTurnProducer({ paths });
  },
  buildReport(ctx) {
    const decode = ctx.decode;
    const viterbiPaths = collectPaths(ctx.heldOut, decode, "viterbi");
    const beamPaths = collectPaths(ctx.heldOut, decode, "beam");
    return analyze({
      taggingDir: ctx.taggingDir,
      latticeDb: ctx.latticeDbRel,
      trainCount: ctx.trainCount,
      heldOutCount: ctx.heldOutCount,
      vocabularySize: ctx.vocabularySize,
      hubTokens: ctx.hubTokens,
      viterbiPaths,
      beamPaths,
    });
  },
  printAnalysis(report) {
    printAnalysis(report as AnalysisReport);
  },
};

export default experiment;
