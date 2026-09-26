import { CsvProducer } from "@/experiments/csv-producer";
import type { ExperimentDefinition } from "@/experiments/types";

export const experiment: ExperimentDefinition = {
  name: "session-span",
  version: "v1",
  createProducer({ paths, fixtureVersion, root }) {
    return new CsvProducer({ paths, fixtureVersion, root });
  },
};

export default experiment;
