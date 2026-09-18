import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export const Field = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Field({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm leading-5 text-ink",
          "shadow-soft outline-none placeholder:text-placeholder transition-[border-color,box-shadow]",
          "focus-blue",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("mb-1.5 block pl-1 text-xs font-medium text-ink-2", className)}>
      {children}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" };

export function Button({ className, variant = "primary", ...props }: BtnProps) {
  return (
    <button
      className={cn(
        "inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold leading-none",
        "transition-[transform,opacity,background-color] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary"
          ? "bg-ink text-background"
          : "border border-line bg-surface text-ink shadow-soft",
        className,
      )}
      {...props}
    />
  );
}

export function Avatar({
  name,
  seed,
  size = 44,
  className,
  photo,
}: {
  name: string;
  seed?: number;
  size?: number;
  className?: string;
  /** Optional data URL; replaces the initial when present. */
  photo?: string | undefined;
}) {
  const hues = ["bg-peach", "bg-blush", "bg-sky", "bg-muted"];
  const tone = hues[(seed ?? name.length) % hues.length];
  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-ink/70 ring-1 ring-surface/70",
        photo ? "bg-surface" : tone,
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
    >
      {photo ? (
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[430px] px-4 sm:px-5", className)}>{children}</div>;
}
