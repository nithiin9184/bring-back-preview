import { useEffect, useState, type KeyboardEvent } from "react";
import { X, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui-kit";

type SignatureEvent = {
  label: string;
  Icon?: LucideIcon;
  name?: string;
  message?: string;
  avatarSeed?: number;
  onOpen?: () => void;
  onDismiss?: () => void;
};

export function SignaturePill({ event }: { event?: SignatureEvent | null }) {
  const [eventVisible, setEventVisible] = useState(Boolean(event));

  useEffect(() => setEventVisible(Boolean(event)), [event]);

  const activeEvent = eventVisible ? event : null;
  const dismissEvent = () => {
    setEventVisible(false);
    event?.onDismiss?.();
  };
  const openEvent = () => {
    setEventVisible(false);
    event?.onOpen?.();
  };
  const handleEventKeyDown = (keyboardEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      openEvent();
    }
  };

  return (
    <div className="flex h-10 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-full border border-ink bg-surface px-2.5">
      {activeEvent ? (
        <div
          role="button"
          tabIndex={0}
          onClick={openEvent}
          onKeyDown={handleEventKeyDown}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-[11px] font-medium text-ink outline-none"
        >
          {activeEvent.name ? (
            <Avatar
              name={activeEvent.name}
              size={22}
              {...(activeEvent.avatarSeed === undefined ? {} : { seed: activeEvent.avatarSeed })}
            />
          ) : null}
          {activeEvent.Icon && !activeEvent.name ? (
            <activeEvent.Icon size={13} strokeWidth={1.9} className="shrink-0" />
          ) : null}
          <span className="shrink-0 font-semibold">{activeEvent.name}</span>
          <span className="min-w-0 flex-1 truncate">
            {activeEvent.message ?? activeEvent.label}
          </span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              dismissEvent();
            }}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-2 transition-colors hover:bg-muted hover:text-ink"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
