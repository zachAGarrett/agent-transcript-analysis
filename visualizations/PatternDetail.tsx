import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import type { PatternDetail as PatternDetailData, PatternNeighbor, Run } from "./data";
import {
  abbreviatePattern,
  decodePatternSteps,
  formatPatternChain,
  patternDisplayLabel,
} from "./decode";

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const stamp = (id: string) => `${id.slice(5, 10)} · ${id.slice(11, 16).replace("-", ":")} UTC`;

async function api<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Query failed.");
  return data as T;
}

function neighborTitle(token: string): string {
  const decoded = decodePatternSteps(token);
  return decoded?.map((step) => step.full).join(" → ") || token;
}

type Props = {
  runId: string;
  nodeId: number;
  version: string;
  onClose: () => void;
  onOpenNeighbor: (runId: string, nodeId: number) => void;
};

export function PatternDetail({ runId, nodeId, version, onClose, onOpenNeighbor }: Props) {
  const [detail, setDetail] = useState<PatternDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    void api<PatternDetailData>(
      `/api/pattern?${new URLSearchParams({ run: runId, node: String(nodeId), version })}`,
    )
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load pattern.");
      });
    return () => {
      cancelled = true;
    };
  }, [runId, nodeId, version]);

  const steps = detail?.steps;
  const title =
    (steps?.length ? formatPatternChain(steps.map((step) => step.brief)) : null) ||
    (detail ? abbreviatePattern(detail.pattern.token) : null) ||
    `Pattern #${nodeId}`;
  const titleFull = steps?.map((step) => step.full).join(" → ") || title;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="pattern-backdrop" />
        <Dialog.Popup className="pattern-popup" id="detail">
          <div className="dialog-head">
            <p className="eyebrow">Pattern</p>
            <Dialog.Title className="sr-only">Pattern</Dialog.Title>
            <Dialog.Close aria-label="Close">Close</Dialog.Close>
          </div>
          <div id="detail-body">
            {error ? (
              <p className="facts">{error}</p>
            ) : !detail ? (
              <p className="facts">Loading…</p>
            ) : (
              <>
                <div className="title-row">
                  <h2 title={titleFull}>{title}</h2>
                  <code className="token" title={detail.pattern.token}>
                    {detail.pattern.token}
                  </code>
                </div>
                <p className="facts">
                  <span className="pattern-id">#{nodeId}</span>
                  {" · "}
                  {stamp(runId)}
                  {" · "}
                  {number(detail.pattern.token_count)} stored counts
                  {detail.pattern.hub_score > 0 ? ` · hub ${number(detail.pattern.hub_score)}` : ""}
                </p>
                {steps?.length ? (
                  <div className="composition">
                    {steps.map((step, i) => (
                      <div key={step.full}>
                        {steps.length > 1 ? <p className="step-label">Step {i + 1}</p> : null}
                        <dl className="meta-grid">
                          {step.atoms.length ? (
                            step.atoms.map((atom) => (
                              <FragmentPair
                                key={`${atom.axis}-${atom.value}`}
                                axis={atom.axis}
                                value={atom.value}
                              />
                            ))
                          ) : (
                            <>
                              <dt>—</dt>
                              <dd>(empty)</dd>
                            </>
                          )}
                        </dl>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="neighbors">
                  <NeighborColumn
                    title="Incoming"
                    group={detail.incoming}
                    runId={runId}
                    onOpen={onOpenNeighbor}
                  />
                  <NeighborColumn
                    title="Outgoing"
                    group={detail.outgoing}
                    runId={runId}
                    onOpen={onOpenNeighbor}
                  />
                </div>
              </>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FragmentPair({ axis, value }: { axis: string; value: string }) {
  return (
    <>
      <dt>{axis}</dt>
      <dd>{value}</dd>
    </>
  );
}

function NeighborColumn({
  title,
  group,
  runId,
  onOpen,
}: {
  title: string;
  group: { rows: PatternNeighbor[]; total?: number; count?: number };
  runId: string;
  onOpen: (runId: string, nodeId: number) => void;
}) {
  return (
    <section>
      <div className="neighbor-head">
        <h3>{title}</h3>
        <small>
          {group.count ?? 0} links · {number(group.total ?? 0)} weight
        </small>
      </div>
      <div className="neighbor-scroll">
        {group.rows.length ? (
          group.rows.map((row) => (
            <button
              key={row.id}
              type="button"
              title={neighborTitle(row.token)}
              onClick={() => onOpen(runId, row.id)}
            >
              <span>
                {patternDisplayLabel({ id: row.id, key: String(row.id), token: row.token })}
              </span>
              <span>{number(row.weight)}</span>
            </button>
          ))
        ) : (
          <p>No links.</p>
        )}
      </div>
    </section>
  );
}

export function runVersion(runs: Run[], runId: string): string {
  return runs.find((run) => run.id === runId)?.version ?? "";
}
