import type { Schema } from "@very-coffee/statespace";
import {
  Grain,
  type GrainKind,
  GrainValues,
  Measure,
  type MeasureKind,
  MeasureValues,
  Source,
  type SourceKind,
  SourceValues,
  Tip,
  type TipKind,
  TipValues,
} from "./ids";
import type { PathStep } from "./types";

export type TimelineChartKind = "graph" | "length" | "accuracy" | "compression";

export type PathState = {
  tip: TipKind;
  grain: GrainKind;
  measure: MeasureKind;
  source: SourceKind;
  faceted: boolean;
  normalized: boolean;
  hasTopK: boolean;
  rankedByLength: boolean;
  limit: number;
  steps: PathStep[];
  hasSelection: boolean;
  selectionRunId: string;
  selectionBinKey: string;
  selectionPatternId: number;
  selectionLengthKey: string;
  detailRequested: boolean;
  timelineRequested: boolean;
  timelineChart: TimelineChartKind;
  /** Selected catalog run has runtime events.jsonl (timeline entry capability). */
  runHasEvents: boolean;
};

export type SelectionContext = {
  runId: string;
  binKey: string;
  patternId?: number;
  lengthKey?: string;
};

export const initialPathState: PathState = {
  tip: Tip.query,
  grain: Grain.none,
  measure: Measure.none,
  source: Source.none,
  faceted: false,
  normalized: false,
  hasTopK: false,
  rankedByLength: false,
  limit: 10,
  steps: [],
  hasSelection: false,
  selectionRunId: "",
  selectionBinKey: "",
  selectionPatternId: 0,
  selectionLengthKey: "",
  detailRequested: false,
  timelineRequested: false,
  timelineChart: "graph",
  runHasEvents: false,
};

export const pathStateSchema: Schema<PathState> = {
  type: "object",
  additionalProperties: false,
  required: [
    "tip",
    "grain",
    "measure",
    "source",
    "faceted",
    "normalized",
    "hasTopK",
    "rankedByLength",
    "limit",
    "steps",
    "hasSelection",
    "selectionRunId",
    "selectionBinKey",
    "selectionPatternId",
    "selectionLengthKey",
    "detailRequested",
    "timelineRequested",
    "timelineChart",
    "runHasEvents",
  ],
  properties: {
    tip: {
      type: "string",
      enum: TipValues,
    },
    grain: { type: "string", enum: GrainValues },
    measure: {
      type: "string",
      enum: MeasureValues,
    },
    source: {
      type: "string",
      enum: SourceValues,
    },
    faceted: { type: "boolean" },
    normalized: { type: "boolean" },
    hasTopK: { type: "boolean" },
    rankedByLength: { type: "boolean" },
    limit: { type: "number" },
    steps: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string" },
          params: {
            type: "object",
            additionalProperties: true,
            required: [],
            nullable: true,
          },
        },
      },
    },
    hasSelection: { type: "boolean" },
    selectionRunId: { type: "string" },
    selectionBinKey: { type: "string" },
    selectionPatternId: { type: "number" },
    selectionLengthKey: { type: "string" },
    detailRequested: { type: "boolean" },
    timelineRequested: { type: "boolean" },
    timelineChart: { type: "string", enum: ["graph", "length", "accuracy", "compression"] },
    runHasEvents: { type: "boolean" },
  },
};
