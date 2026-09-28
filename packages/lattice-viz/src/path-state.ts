import type { Schema } from "@statespace/core";
import type { PathStep, TipKind } from "./types";

export type PathState = {
  tip: TipKind;
  grain: "none" | "run" | "pattern" | "length" | "pattern-by-length";
  measure: "none" | "stored-count" | "vocabulary" | "edge-weight";
  source: "none" | "pattern-mass" | "pattern-vocab" | "edge-weight" | "run-scalars";
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
};

export type SelectionContext = {
  runId: string;
  binKey: string;
  patternId?: number;
  lengthKey?: string;
};

export const initialPathState: PathState = {
  tip: "query",
  grain: "none",
  measure: "none",
  source: "none",
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
  ],
  properties: {
    tip: {
      type: "string",
      enum: ["query", "summary", "displayed", "faceted", "selected", "committed"],
    },
    grain: { type: "string", enum: ["none", "run", "pattern", "length", "pattern-by-length"] },
    measure: {
      type: "string",
      enum: ["none", "stored-count", "vocabulary", "edge-weight"],
    },
    source: {
      type: "string",
      enum: ["none", "pattern-mass", "pattern-vocab", "edge-weight", "run-scalars"],
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
  },
};

/** Session morphisms update tip only — never appear in the construction plan. */
export const SESSION_MORPHISMS = new Set([
  "select_bin",
  "clear_selection",
  "open_pattern_detail",
  "close_pattern_detail",
]);
