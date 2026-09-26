import { AgentTurnProducer } from "@/experiments/agent-turn-producer";
import type { ExperimentDefinition } from "@/experiments/types";

export const experiment: ExperimentDefinition = {
  name: "agent-turn",
  version: "v1",
  createProducer({ paths }) {
    return new AgentTurnProducer({ paths });
  },
};

export default experiment;
