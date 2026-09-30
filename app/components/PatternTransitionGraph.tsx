import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react";
import { formatPatternBriefChain, patternDisplayLabel } from "@/app/adapters/decode";
import type { TimelineNext } from "@/app/adapters/runtime-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export const NEXT_SLOTS = 8;

function patternLabel(token: string): string {
  return formatPatternBriefChain(token) || patternDisplayLabel({ key: token, token });
}

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

function nextSubtitle(slot: TimelineNext): string | undefined {
  return (
    [slot.symbol && slot.symbol !== slot.pattern ? `→ ${slot.symbol}` : null, slot.source]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}

function PriorHitBadge({ hit }: { hit: boolean }) {
  const label = hit ? "Predicted by prior step" : "Not predicted by prior step";
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="inline-flex shrink-0" />}
        onClick={(e) => e.stopPropagation()}
      >
        <Badge
          variant={hit ? "default" : "destructive"}
          className={`size-5 px-1 ${
            hit
              ? "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400"
              : "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-400"
          }`}
          aria-label={label}
        >
          {hit ? <CheckIcon className="size-3.5" /> : <XIcon className="size-3.5" />}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-left whitespace-normal">
        {hit
          ? "Prior step ranked this source symbol in its top-k forecast (hit@k)."
          : "Prior step’s top-k forecast missed this source symbol."}
      </TooltipContent>
    </Tooltip>
  );
}

function PatternButton({
  token,
  empty,
  score,
  subtitle,
  trailing,
  ...props
}: Omit<
  React.ComponentProps<typeof Button>,
  "type" | "size" | "tabIndex" | "aria-hidden" | "disabled" | "className"
> & {
  token?: string;
  empty?: boolean;
  score?: number;
  subtitle?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      tabIndex={empty ? -1 : undefined}
      aria-hidden={empty || undefined}
      disabled={empty}
      className={`h-auto min-h-8 w-full max-w-full justify-between gap-2 px-2 py-1.5 text-left font-mono text-xs whitespace-normal ${
        empty ? "invisible pointer-events-none" : ""
      }`}
      {...props}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="truncate">{empty || !token ? "—" : patternLabel(token)}</span>
        {subtitle ? (
          <span className="text-muted-foreground truncate text-[10px] font-sans normal-case">
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing}
      {score !== undefined ? (
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          {number(score)}
        </Badge>
      ) : null}
    </Button>
  );
}

export type PatternTransitionGraphProps = {
  prevToken?: string;
  currentToken?: string;
  next: TimelineNext[];
  /** Whether the prior step's forecast included the current source symbol (hit@k). */
  priorHit?: boolean;
  /** Open pattern detail for a token (prev, current, or predicted next). */
  onPatternClick?: (token: string) => void;
};

/**
 * Three-column prev → current → predicted-next graph.
 * Top prediction is always visible; remaining next slots sit in a collapsed group
 * in the second-slot position.
 */
export function PatternTransitionGraph({
  prevToken,
  currentToken,
  next,
  priorHit,
  onPatternClick,
}: PatternTransitionGraphProps) {
  const capped = next.slice(0, NEXT_SLOTS);
  const top = capped[0];
  const rest = capped.slice(1);

  const click =
    onPatternClick === undefined
      ? undefined
      : (token: string | undefined) => {
          if (token) onPatternClick(token);
        };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] items-start gap-x-2 gap-y-1">
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Prev
      </div>
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Current
      </div>
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Predicted next
      </div>

      <div className="flex min-w-0 items-center self-start">
        <PatternButton
          token={prevToken}
          variant="secondary"
          empty={!prevToken}
          onClick={() => click?.(prevToken)}
        />
      </div>

      <div className="flex min-w-0 items-center self-start">
        <PatternButton
          token={currentToken}
          variant="outline"
          empty={!currentToken}
          trailing={priorHit !== undefined ? <PriorHitBadge hit={priorHit} /> : undefined}
          onClick={() => click?.(currentToken)}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <PatternButton
          token={top?.pattern}
          variant="outline"
          empty={!top}
          score={top?.prob}
          subtitle={top ? nextSubtitle(top) : undefined}
          onClick={() => click?.(top?.pattern)}
        />

        {rest.length > 0 ? (
          <Collapsible defaultOpen={false} className="group/next min-w-0">
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-muted-foreground h-auto min-h-8 w-full justify-between gap-2 px-2 py-1.5 text-xs"
                />
              }
            >
              <span className="flex items-center gap-1.5">
                <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-open/next:rotate-180" />
                {rest.length} more
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-1 pt-1">
              {rest.map((slot) => (
                <PatternButton
                  key={`${slot.pattern}\0${slot.symbol}\0${slot.source}\0${slot.prob}`}
                  token={slot.pattern}
                  variant="outline"
                  score={slot.prob}
                  subtitle={nextSubtitle(slot)}
                  onClick={() => click?.(slot.pattern)}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </div>
  );
}
