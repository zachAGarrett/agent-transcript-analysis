import { ChevronRightIcon } from "lucide-react";
import { formatPatternBriefChain, patternDisplayLabel } from "@/app/adapters/decode";
import type { TimelineNext } from "@/app/adapters/runtime-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const NEXT_SLOTS = 8;

function patternLabel(token: string): string {
  return formatPatternBriefChain(token) || patternDisplayLabel({ key: token, token });
}

const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);

function PatternButton({
  token,
  empty,
  score,
  ...props
}: Omit<
  React.ComponentProps<typeof Button>,
  "type" | "size" | "tabIndex" | "aria-hidden" | "disabled" | "className"
> & {
  token?: string;
  empty?: boolean;
  score?: number;
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
      <span className="min-w-0 flex-1 truncate text-left">
        {empty || !token ? "—" : patternLabel(token)}
      </span>
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
  /** Open pattern detail for a token (prev, current, or predicted next). */
  onPatternClick?: (token: string) => void;
};

/**
 * Fixed three-column prev → current → predicted-next graph.
 * Always renders NEXT_SLOTS next rows so scrubbing does not shift layout.
 */
export function PatternTransitionGraph({
  prevToken,
  currentToken,
  next,
  onPatternClick,
}: PatternTransitionGraphProps) {
  const capped = next.slice(0, NEXT_SLOTS);
  const slots: Array<TimelineNext | null> = Array.from(
    { length: NEXT_SLOTS },
    (_, i) => capped[i] ?? null,
  );

  const click =
    onPatternClick === undefined
      ? undefined
      : (token: string | undefined) => {
          if (token) onPatternClick(token);
        };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.2fr)] items-start gap-x-2 gap-y-1">
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Prev
      </div>
      <div />
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Current
      </div>
      <div />
      <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
        Predicted next
      </div>

      <div className="flex min-w-0 items-center">
        <PatternButton
          token={prevToken}
          variant="secondary"
          empty={!prevToken}
          onClick={() => click?.(prevToken)}
        />
      </div>

      <div className="flex min-h-8 items-center">
        <ChevronRightIcon
          className={`text-muted-foreground size-4 shrink-0 ${prevToken ? "" : "invisible"}`}
          aria-hidden
        />
      </div>

      <div className="flex min-w-0 items-center">
        <PatternButton
          token={currentToken}
          variant="default"
          empty={!currentToken}
          onClick={() => click?.(currentToken)}
        />
      </div>

      <div className="flex flex-col gap-1">
        {slots.map((slot, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed slot index
            key={i}
            className="flex min-h-8 items-center justify-center"
          >
            <ChevronRightIcon
              className={`text-muted-foreground size-4 shrink-0 ${slot ? "" : "invisible"}`}
              aria-hidden
            />
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        {slots.map((slot, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed slot index
            key={i}
            className="min-w-0"
          >
            <PatternButton
              token={slot?.pattern}
              variant="outline"
              empty={!slot}
              score={slot?.prob}
              onClick={() => click?.(slot?.pattern)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
