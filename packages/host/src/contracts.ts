import type { ILattice } from "@khoralabs/tkn";
import type { DecodeSnapshot } from "./decoder";
import type { LoopEvent } from "./loop";

/** Caller-chosen lattice persistence backend. */
export type LatticePersistence =
  | { kind: "sqlite"; filename: string }
  | { kind: "memory" }
  | { kind: "turso"; filename: string };

/**
 * Open lattice handle with a process-wide write mutex for shared-vocabulary streams.
 * Registry / id lookup is a host concern.
 */
export type LatticeRef = {
  readonly id?: string;
  readonly persistence: LatticePersistence;
  readonly lattice: ILattice;
  runExclusive<T>(fn: () => T | Promise<T>): Promise<T>;
  close(): void;
};

/** Host-defined preprocessor: null drops the item. */
export type PreprocessFn<T> = (item: T, index: number) => Promise<string | null>;

/** Single-writer ingest pipeline bound to one lattice. */
export type StreamHandle<T> = {
  feed(source: AsyncIterable<T>): AsyncGenerator<LoopEvent>;
  /** Non-mutating live decode/forecast view. */
  snapshot(): DecodeSnapshot;
  end(): Promise<void>;
  close(): Promise<void>;
};
