import { cn } from "cn";
import { useLayoutEffect, useRef, useState } from "react";

type Props = {
  className?: string;
  children: React.ReactNode;
};

/**
 * Overflow-y region with edge fade only when content actually overflows.
 * Avoids fading/clipping short lists that fit without scrolling.
 */
export function ScrollFade({ className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    const content = contentRef.current;
    if (!el) return;
    const check = () => {
      setOverflow(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (content) ro.observe(content);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("overflow-y-auto", overflow && "scroll-fade", className)}>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}
