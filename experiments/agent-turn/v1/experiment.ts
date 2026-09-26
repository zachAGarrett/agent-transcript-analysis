import { AgentTurnProducer } from "@/experiments/agent-turn-producer";
import type { ExperimentDefinition } from "@/experiments/types";

export const experiment: ExperimentDefinition = {
  name: "agent-turn",
  version: "v1",
  createProducer({ paths, fixtureVersion, root }) {
    return new AgentTurnProducer({ paths, fixtureVersion, root });
  },
};

export default experiment;
