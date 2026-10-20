import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  abbreviatePattern,
  formatPatternBriefChain,
  formatPatternChain,
  patternDisplayLabel,
} from "@/app/adapters/decode";
import { VisualizationCard } from "@/app/components/VisualizationCard";
import type { PatternDetail as PatternDetailData, PatternNeighbor, Run } from "@/app/viz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
  return formatPatternBriefChain(token) || token;
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
  const titleBrief =
    (steps?.length ? steps.map((step) => step.brief).join(" → ") : null) ||
    (detail ? formatPatternBriefChain(detail.pattern.token) : null) ||
    title;
  const encodingFull = detail?.pattern.token ?? "";
  const encodingShort = encodingFull
    ? `${formatPatternChain(encodingFull.split("|").filter(Boolean), "|")}|`
    : "";

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        id="detail"
        className="flex max-h-[min(90vh,720px)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton
      >
        <DialogHeader className="gap-1 border-b px-4 py-3">
          <p className="text-muted-foreground text-[10px] font-semibold tracking-[0.18em] uppercase">
            Pattern
          </p>
          <DialogTitle className="sr-only">Pattern</DialogTitle>
          <DialogDescription className="sr-only">Pattern detail for #{nodeId}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 px-4 py-3">
          {error ? (
            <p className="text-muted-foreground text-sm">{error}</p>
          ) : !detail ? (
            <div className="space-y-3">
              <Skeleton className="h-7 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-lg leading-snug font-medium">
                  <Tooltip>
                    <TooltipTrigger render={<span className="cursor-default" />}>
                      {title}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm text-left whitespace-normal">
                      {titleBrief}
                    </TooltipContent>
                  </Tooltip>
                </h2>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <code className="bg-muted inline-block max-w-full truncate rounded-md px-2 py-1 font-mono text-[11px]" />
                    }
                  >
                    {encodingShort}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm font-mono text-[11px] break-all">
                    {encodingFull}
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-muted-foreground text-xs">
                <Badge variant="secondary" className="mr-1 font-mono">
                  #{nodeId}
                </Badge>
                {stamp(runId)} · {number(detail.pattern.token_count)} stored counts
                {detail.pattern.hub_score > 0 ? ` · hub ${number(detail.pattern.hub_score)}` : ""}
              </p>
              {steps?.length ? (
                <Collapsible defaultOpen={false} className="group">
                  <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                    <ChevronRightIcon className="transition-transform group-data-open:rotate-90" />
                    Tags
                    <span className="text-muted-foreground font-normal">
                      · {steps.reduce((n, step) => n + step.atoms.length, 0)} fields
                      {steps.length > 1 ? ` · ${steps.length} steps` : ""}
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3">
                    <div className="scroll-fade max-h-40 overflow-y-auto">
                      <div className="space-y-3 pr-1">
                        {steps.map((step, i) => (
                          <div key={step.full}>
                            {steps.length > 1 ? (
                              <p className="text-muted-foreground mb-1 text-[10px] font-semibold tracking-wide uppercase">
                                Step {i + 1}
                              </p>
                            ) : null}
                            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
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
                                  <dt className="text-muted-foreground">—</dt>
                                  <dd>(empty)</dd>
                                </>
                              )}
                            </dl>
                          </div>
                        ))}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
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
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function FragmentPair({ axis, value }: { axis: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{axis}</dt>
      <dd className="font-medium">{value}</dd>
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
    <VisualizationCard size="sm">
      <VisualizationCard.Header>
        <VisualizationCard.Title>{title}</VisualizationCard.Title>
        <VisualizationCard.Action>
          <span className="text-muted-foreground text-[10px]">
            {group.count ?? 0} links · {number(group.total ?? 0)} weight
          </span>
        </VisualizationCard.Action>
      </VisualizationCard.Header>
      <VisualizationCard.Content>
        <div className="scroll-fade max-h-40 overflow-y-auto">
          <div className="flex flex-col gap-0.5 pr-1">
            {group.rows.length ? (
              group.rows.map((row) => (
                <Tooltip key={row.id}>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-between gap-2 px-2 py-1.5 font-normal"
                        onClick={() => onOpen(runId, row.id)}
                      />
                    }
                  >
                    <span className="truncate text-left">
                      {patternDisplayLabel({ id: row.id, key: String(row.id), token: row.token })}
                    </span>
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {row.prob != null
                        ? `${(row.prob * 100).toFixed(1)}% · ${number(row.weight)}`
                        : number(row.weight)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-sm text-left whitespace-normal">
                    {neighborTitle(row.token)}
                  </TooltipContent>
                </Tooltip>
              ))
            ) : (
              <p className="text-muted-foreground px-2 py-1 text-xs">No links.</p>
            )}
          </div>
        </div>
      </VisualizationCard.Content>
    </VisualizationCard>
  );
}

export function runVersion(runs: Run[], runId: string): string {
  return runs.find((run) => run.id === runId)?.version ?? "";
}
