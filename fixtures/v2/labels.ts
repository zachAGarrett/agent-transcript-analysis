/** Closed label sets for Jev Choice criteria (v2 intent / purpose). */

export const INTENT_LABELS = [
  "plan",
  "implement",
  "fix",
  "refactor",
  "explain",
  "review",
  "test",
  "other",
] as const;

export type IntentLabel = (typeof INTENT_LABELS)[number];

export const PURPOSE_LABELS = [
  "explore",
  "edit",
  "verify",
  "plan",
  "ask",
  "narrate",
  "other",
] as const;

export type PurposeLabel = (typeof PURPOSE_LABELS)[number];

/** Structured Choice option descriptions (what / not_for / examples). */
export const INTENT_CRITERIA: Record<
  IntentLabel,
  { what: string; not_for: string; examples: string[] }
> = {
  plan: {
    what: "Ask to design, architect, specify, or outline an approach before coding",
    not_for: "Requests that already ask to implement, fix, or explain existing code",
    examples: ["Plan the migration", "Design the API shape", "Write a spec for auth"],
  },
  implement: {
    what: "Ask to add, create, build, or write new functionality",
    not_for: "Bug fixes, refactors, explanations, or review-only asks",
    examples: ["Add a prepare CLI flag", "Create the fixtures/v2 module", "Build the eval script"],
  },
  fix: {
    what: "Ask to repair a bug, error, failure, or broken behavior",
    not_for: "Greenfield features, refactors without a defect, or pure explanations",
    examples: ["Fix the null crash", "The prepare command fails", "Bug in CSV encoding"],
  },
  refactor: {
    what: "Ask to restructure, rename, clean up, or reorganize without changing intent",
    not_for: "New features, bug fixes, or documentation-only questions",
    examples: ["Refactor the loader", "Rename taxonomy axes", "Clean up the encoder"],
  },
  explain: {
    what: "Ask how/why something works or what something is",
    not_for: "Requests to change code or run tests",
    examples: [
      "How does prepare work?",
      "What is the codebook?",
      "Why is intent empty on agent rows?",
    ],
  },
  review: {
    what: "Ask to audit, check, or review code/design quality",
    not_for: "Implementing changes or answering factual how-it-works questions alone",
    examples: ["Review this PR", "Audit the taxonomy", "Check my approach"],
  },
  test: {
    what: "Ask to write, run, or improve tests and coverage",
    not_for: "Implementing product features without a testing focus",
    examples: ["Add unit tests", "Run the encoder tests", "Improve coverage"],
  },
  other: {
    what: "Greeting, meta chat, or request that does not fit another intent",
    not_for: "Clear plan/implement/fix/refactor/explain/review/test asks",
    examples: ["Thanks", "Continue", "Use the plan attached"],
  },
};

export const PURPOSE_CRITERIA: Record<
  PurposeLabel,
  { what: string; not_for: string; examples: string[] }
> = {
  explore: {
    what: "Read, search, or inspect code/docs to gather information",
    not_for: "Writing edits, running verification, or asking the user a question",
    examples: ["Read a file", "Grep for taxonomy", "Glob fixtures/**"],
  },
  edit: {
    what: "Create or modify files (write, patch, delete)",
    not_for: "Read-only exploration or test-only shell commands",
    examples: ["Write taxonomy.ts", "StrReplace in load.ts", "Delete a temp file"],
  },
  verify: {
    what: "Run checks, tests, typecheck, or inspect command output to confirm correctness",
    not_for: "Editing source or open-ended exploration",
    examples: ["bun test", "bun run typecheck", "git status after a change"],
  },
  plan: {
    what: "Outline next steps, create a plan, or organize work without executing it yet",
    not_for: "Actually editing files or running verification",
    examples: ["CreatePlan", "TodoWrite listing steps", "I'll do X then Y"],
  },
  ask: {
    what: "Ask the user a clarifying question or request a decision",
    not_for: "Narrating progress or exploring the codebase alone",
    examples: ["Which transcript should we use?", "AskQuestion tool"],
  },
  narrate: {
    what: "Explain progress, summarize findings, or talk to the user without tools",
    not_for: "Tool calls that read/edit/verify, or direct user questions",
    examples: ["I've scaffolded v2", "Here is what the loader does"],
  },
  other: {
    what: "Agent step that does not fit explore/edit/verify/plan/ask/narrate",
    not_for: "Clear exploration, edits, verification, planning, questions, or narration",
    examples: ["ConnectScm", "opaque MCP call with unclear goal"],
  },
};
