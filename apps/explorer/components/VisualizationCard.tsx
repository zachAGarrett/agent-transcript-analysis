import { cn } from "cn";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function VisualizationCardRoot({ size = "default", ...props }: React.ComponentProps<typeof Card>) {
  return <Card data-visualization-card="" size={size} {...props} />;
}

function VisualizationCardHeader({ className, ...props }: React.ComponentProps<typeof CardHeader>) {
  return <CardHeader className={cn("pb-2", className)} {...props} />;
}

function VisualizationCardTitle({ className, ...props }: React.ComponentProps<typeof CardTitle>) {
  return <CardTitle className={cn("text-sm", className)} {...props} />;
}

function VisualizationCardDescription(props: React.ComponentProps<typeof CardDescription>) {
  return <CardDescription {...props} />;
}

function VisualizationCardAction(props: React.ComponentProps<typeof CardAction>) {
  return <CardAction {...props} />;
}

function VisualizationCardContent(props: React.ComponentProps<typeof CardContent>) {
  return <CardContent {...props} />;
}

function VisualizationCardFooter({ className, ...props }: React.ComponentProps<typeof CardFooter>) {
  return (
    <CardFooter
      className={cn("border-0 bg-transparent text-muted-foreground text-[11px]", className)}
      {...props}
    />
  );
}

/**
 * Shared chrome for explorer visualizations (compound Card).
 *
 * @example
 * ```tsx
 * <VisualizationCard>
 *   <VisualizationCard.Header>
 *     <VisualizationCard.Title>Transitions</VisualizationCard.Title>
 *     <VisualizationCard.Action>…</VisualizationCard.Action>
 *   </VisualizationCard.Header>
 *   <VisualizationCard.Content>…</VisualizationCard.Content>
 * </VisualizationCard>
 * ```
 */
export const VisualizationCard = Object.assign(VisualizationCardRoot, {
  Header: VisualizationCardHeader,
  Title: VisualizationCardTitle,
  Description: VisualizationCardDescription,
  Action: VisualizationCardAction,
  Content: VisualizationCardContent,
  Footer: VisualizationCardFooter,
});
