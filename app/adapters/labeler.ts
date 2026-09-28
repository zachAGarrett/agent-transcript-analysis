/** Browser-safe: wires fixture-aware pattern labels without importing SQLite adapters. */
import { setPatternLabeler } from "@workstream/lattice-viz";
import { patternDisplayLabel } from "./decode";

setPatternLabeler(patternDisplayLabel);
