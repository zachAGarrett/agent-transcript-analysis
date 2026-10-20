/** Browser-safe: wires fixture-aware pattern labels without importing SQLite adapters. */
import { setPatternLabeler } from "@/app/viz";
import { patternDisplayLabel } from "./decode";

setPatternLabeler(patternDisplayLabel);
