import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { Screen } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

type IconType = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export function SettingsShell({
  title,
  subtitle,
  onBack,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: ReactNode;
  action?: ReactNode;
}) {
  const router = useRouter();
  return (
    <main className="app-page">
      <Screen>
        <header className="app-header grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3">
          <button
            type="button"
            onClick={() => (onBack ? onBack() : router.history.back())}
            aria-label="Back"
            className="icon-control active:scale-[0.98]"
          >
            <ChevronLeft size={19} strokeWidth={1.9} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold leading-6 text-ink">
              {title}
            </h1>
            {subtitle && <p className="truncate text-[11px] text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </header>
        <div>
          {children}
        </div>
      </Screen>
    </main>
  );
}

export function Group({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-8", className)}>
      {label && (
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
          {label}
        </h2>
      )}
      <ul>{children}</ul>
    </section>
  );
}

function RowBody({
  Icon,
  title,
  note,
  right,
  danger,
}: {
  Icon?: IconType;
  title: string;
  note?: string;
  right?: ReactNode;
  danger?: boolean;
}) {
  return (
    <>
      {Icon && (
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center text-ink-2",
            danger ? "text-red-500" : "text-ink",
          )}
        >
          <Icon size={18} strokeWidth={1.8} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm font-medium leading-5",
            danger ? "text-red-500" : "text-ink",
          )}
        >
          {title}
        </span>
        {note && <span className="block truncate text-xs leading-4 text-ink-2">{note}</span>}
      </span>
      {right}
    </>
  );
}

const rowClass =
  "flex min-h-14 w-full items-center gap-3 py-2 text-left transition-colors active:bg-muted/70";

export function ActionRow({
  onSelect,
  Icon,
  title,
  note,
  value,
  danger,
  chevron = true,
}: {
  onSelect?: () => void;
  Icon?: IconType;
  title: string;
  note?: string;
  value?: string;
  danger?: boolean;
  chevron?: boolean;
}) {
  return (
    <li>
      <button type="button" onClick={onSelect} className={rowClass}>
        <RowBody
          {...(Icon ? { Icon } : {})}
          title={title}
          {...(note ? { note } : {})}
          {...(danger ? { danger: true } : {})}
          right={
            <span className="flex shrink-0 items-center gap-1.5">
              {value && <span className="text-[12px] text-ink-3">{value}</span>}
              {chevron && <ChevronRight size={17} strokeWidth={1.8} className="text-ink-3" />}
            </span>
          }
        />
      </button>
    </li>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
        on ? "bg-brand" : "bg-toggle-off",
      )}
    >
      <span
        className={cn(
          "absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full bg-surface shadow-toggle transition-transform duration-300 ease-out",
          on && "translate-x-4",
        )}
      />
    </button>
  );
}

export function ToggleRow({
  Icon,
  title,
  note,
  on,
  onChange,
}: {
  Icon?: IconType;
  title: string;
  note?: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <li>
      <div className={cn(rowClass, "active:bg-transparent")}>
        <RowBody
          {...(Icon ? { Icon } : {})}
          title={title}
          {...(note ? { note } : {})}
          right={<Toggle on={on} onChange={onChange} />}
        />
      </div>
    </li>
  );
}

export function ChoiceRow({
  title,
  options,
  value,
  onChange,
  locked,
  optionStyle,
  swatch,
}: {
  title: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  /** Options that need Premium; they stay visible with a small lock. */
  locked?: (option: string) => boolean;
  /** Renders an option in its own typography, for the chat font picker. */
  optionStyle?: (option: string) => React.CSSProperties | undefined;
  /** Small colour dot shown before the label, for the bubble colour picker. */
  swatch?: (option: string) => string | undefined;
}) {
  return (
    <li className="px-1 py-3.5">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map((o) => {
          const isLocked = locked?.(o) ?? false;
          const dot = swatch?.(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onChange(o)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-semibold transition-colors active:scale-[0.98]",
                value === o ? "bg-ink text-background" : "border border-line bg-surface text-ink-2",
                isLocked && value !== o && "text-ink-3",
              )}
              style={optionStyle?.(o)}
            >
              {dot && (
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-line"
                  style={{ background: dot }}
                />
              )}
              {o}
              {isLocked && <Lock size={11} strokeWidth={2.2} />}
            </button>
          );
        })}
      </div>
    </li>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <p className="mt-2.5 px-1 text-[11.5px] leading-relaxed text-ink-2">{children}</p>;
}
