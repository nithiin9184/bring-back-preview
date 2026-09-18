import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Ring shown around a person's DP for their live 24-hour status.
 * "unseen" -> solid blue ring, "seen" -> solid gray ring, null -> no ring.
 */
export type StatusRingState = "unseen" | "seen" | null;

export function StatusRing({
  state,
  size,
  className,
  children,
}: {
  state: StatusRingState;
  /** Outer box size in px; the DP inside should be ~8px smaller. */
  size: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "grid place-items-center rounded-full",
        state === "unseen" && "border-2 border-brand",
        state === "seen" && "border-2 border-ink-3",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}
