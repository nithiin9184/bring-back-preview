import type { ReactNode } from "react";

export type SheetAction = {
  label: string;
  Icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  tone?: "default" | "danger";
  onSelect?: () => void | Promise<void>;
};

export function GlassSheet({
  open,
  title,
  actions,
  onClose,
  children,
}: {
  open: boolean;
  title?: string | undefined;
  actions?: SheetAction[];
  onClose: () => void;
  children?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
        style={{ animation: "rise-in 220ms ease both" }}
      />
      <div className="absolute inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[430px] px-3 pb-3">
          <div
            className="glass overflow-hidden rounded-xl px-2 pb-2 pt-2"
            style={{ animation: "rise-in 260ms cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-ink/15" />
            {title && <p className="px-3 pb-1.5 text-[12px] font-medium text-ink-2">{title}</p>}
            {children}
            {actions?.map(({ label, Icon, tone, onSelect }) => (
              <button
                key={label}
                onClick={async () => {
                  await onSelect?.();
                  onClose();
                }}
                className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-sm font-medium transition-colors active:bg-muted/70 ${
                  tone === "danger" ? "text-danger" : "text-ink"
                }`}
              >
                {Icon && <Icon size={18} strokeWidth={1.8} className="shrink-0" />}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
