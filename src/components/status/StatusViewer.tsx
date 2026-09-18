import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Eye, MoreVertical, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import type { StatusEntry } from "@/data/types";

/** How long a photo or text status stays on screen, in milliseconds. */
const STILL_DURATION = 5000;
const HOLD_DELAY = 300;
const TAP_MOVE_TOLERANCE = 10;

function timeAgo(ts: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

function viewedAt(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function StatusViewer({
  entries,
  startIndex = 0,
  ownerName,
  ownerPhoto,
  canDelete,
  onDelete,
  onSeen,
  onClose,
}: {
  entries: StatusEntry[];
  startIndex?: number;
  ownerName: string;
  ownerPhoto?: string | undefined;
  canDelete: boolean;
  onDelete?: (id: string) => void;
  onSeen: (id: string) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const [menu, setMenu] = useState(false);
  const [viewers, setViewers] = useState(false);
  const holding = useRef(false);
  const viewersOpen = useRef(false);
  const elapsed = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const pointer = useRef<{
    id: number;
    startedAt: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const swipe = useRef<number | null>(null);

  const current = entries[Math.min(index, entries.length - 1)];

  useEffect(() => setIndex(startIndex), [startIndex, entries.length]);

  useEffect(() => {
    if (current) onSeen(current.id);
    elapsed.current = 0;
    holding.current = false;
    pointer.current = null;
    setProgress(0);
    setMenu(false);
    setViewers(false);
  }, [current?.id]);

  useEffect(() => {
    viewersOpen.current = viewers;
  }, [viewers]);

  const next = useCallback(() => {
    if (index + 1 >= entries.length) {
      onClose();
      return;
    }
    setIndex(index + 1);
  }, [entries.length, index, onClose]);

  const prev = () => setIndex((i) => Math.max(0, i - 1));

  // Progress timer for photo and text statuses; held time is never counted.
  useEffect(() => {
    if (!current || current.video) return;
    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      if (!holding.current && !viewersOpen.current) {
        elapsed.current += now - lastTick;
      }
      lastTick = now;
      const pct = Math.min(1, elapsed.current / STILL_DURATION);
      setProgress(pct);
      if (pct >= 1) {
        window.clearInterval(id);
        next();
      }
    }, 60);
    return () => window.clearInterval(id);
  }, [current?.id, current?.video, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, onClose]);

  const views = useMemo(() => [...(current?.views ?? [])].reverse(), [current?.views]);
  const privateViews = views.filter((v) => v.audience !== "public").length;
  const publicViews = views.length - privateViews;

  const beginMediaPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointer.current = {
      id: event.pointerId,
      startedAt: performance.now(),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    holding.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    videoRef.current?.pause();
  };

  const trackMediaPress = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >
      TAP_MOVE_TOLERANCE
    ) {
      active.moved = true;
    }
  };

  const finishMediaPress = (
    event: React.PointerEvent<HTMLButtonElement>,
    direction: "previous" | "next",
    cancelled = false,
  ) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const wasHold = performance.now() - active.startedAt >= HOLD_DELAY;
    const shouldNavigate = !cancelled && !active.moved && !wasHold;
    pointer.current = null;
    holding.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (current?.video && !viewersOpen.current) {
      void videoRef.current?.play().catch(() => undefined);
    }
    if (shouldNavigate) {
      if (direction === "previous") prev();
      else next();
    }
  };

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black">
      <div className="relative mx-auto flex h-full w-full max-w-[430px] flex-col">
        {/* Progress indicators */}
        <div className="flex gap-1 px-3 pt-[max(10px,env(safe-area-inset-top))]">
          {entries.map((e, i) => (
            <span key={e.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
              <span
                className="block h-full rounded-full bg-white"
                style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
              />
            </span>
          ))}
        </div>

        {/* Header */}
        <header className="flex items-center gap-3 px-3 py-3">
          <Avatar
            name={ownerName || "N"}
            seed={(ownerName || "N").length}
            size={36}
            photo={ownerPhoto}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-white">
              {ownerName}
            </span>
            <span className="block truncate text-[11.5px] text-white/70">
              {timeAgo(current.createdAt)} ·{" "}
              {current.visibility === "public" ? "Public" : "Private"}
            </span>
          </span>
          <button
            aria-label="Status options"
            onClick={() => setMenu((v) => !v)}
            className="grid h-9 w-9 place-items-center rounded-full text-white/90"
          >
            <MoreVertical size={19} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Close status"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full text-white/90"
          >
            <X size={19} strokeWidth={1.8} />
          </button>
        </header>

        {menu && canDelete && (
          <div className="absolute right-3 top-[64px] z-20 w-44 overflow-hidden rounded-[18px] bg-white/95 shadow-soft backdrop-blur">
            <button
              onClick={() => {
                setMenu(false);
                onDelete?.(current.id);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-[13.5px] font-medium text-red-500"
            >
              <Trash2 size={16} strokeWidth={1.8} />
              Delete Status
            </button>
          </div>
        )}

        {/* Media — centered and fully visible at its original aspect ratio. */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
          <div className="absolute inset-0 flex items-center justify-center">
            {current.image && (
              <img
                src={current.image}
                alt="Status"
                draggable={false}
                className="block max-h-full max-w-full select-none object-contain"
              />
            )}
            {current.video && (
              <video
                ref={videoRef}
                key={current.id}
                src={current.video}
                playsInline
                autoPlay
                controls={false}
                onLoadedMetadata={(e) => (e.currentTarget.currentTime = current.videoStart ?? 0)}
                onTimeUpdate={(e) => {
                  const el = e.currentTarget;
                  const start = current.videoStart ?? 0;
                  const end = current.videoEnd ?? (el.duration || 0);
                  const span = Math.max(0.1, end - start);
                  setProgress(Math.min(1, Math.max(0, (el.currentTime - start) / span)));
                  if (end && el.currentTime >= end) next();
                }}
                onEnded={next}
                className="block max-h-full max-w-full object-contain"
              />
            )}
            {!current.image && !current.video && current.text && (
              <div
                className="relative h-full w-full"
                style={current.background ? { background: current.background } : undefined}
              >
                <p
                  className="absolute inset-x-7 -translate-y-1/2 whitespace-pre-wrap text-[22px] font-semibold leading-[1.35] text-white"
                  style={{
                    top: `${current.textY ?? 50}%`,
                    textAlign: current.textAlign ?? "center",
                  }}
                >
                  {current.text}
                </p>
              </div>
            )}
          </div>

          {/* Tap navigates; holding freezes progress and media without navigating. */}
          <button
            aria-label="Previous status"
            onPointerDown={beginMediaPress}
            onPointerMove={trackMediaPress}
            onPointerUp={(event) => finishMediaPress(event, "previous")}
            onPointerCancel={(event) => finishMediaPress(event, "previous", true)}
            onContextMenu={(event) => event.preventDefault()}
            className="absolute inset-y-0 left-0 w-1/3 touch-none select-none"
          />
          <button
            aria-label="Next status"
            onPointerDown={beginMediaPress}
            onPointerMove={trackMediaPress}
            onPointerUp={(event) => finishMediaPress(event, "next")}
            onPointerCancel={(event) => finishMediaPress(event, "next", true)}
            onContextMenu={(event) => event.preventDefault()}
            className="absolute inset-y-0 right-0 w-2/3 touch-none select-none"
          />

        </div>

        {current.caption && (current.image || current.video) && (
          <div className="shrink-0 bg-black px-5 py-3 text-center">
            <p className="whitespace-pre-wrap text-[14px] font-medium leading-[1.45] text-white">
              {current.caption}
            </p>
          </div>
        )}

        {/* View count — tap or swipe up from the bottom to open the viewers */}
        {canDelete && (
          <button
            onClick={() => setViewers(true)}
            onPointerDown={(e) => (swipe.current = e.clientY)}
            onPointerMove={(e) => {
              if (swipe.current !== null && swipe.current - e.clientY > 28) {
                swipe.current = null;
                setViewers(true);
              }
            }}
            onPointerUp={() => (swipe.current = null)}
            onPointerCancel={() => (swipe.current = null)}
            aria-label={`${views.length} views — swipe up for viewers`}
            className="flex touch-none flex-col items-center justify-end gap-1 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-6 text-white/90"
          >
            <ChevronUp size={18} strokeWidth={2.2} />
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
              <Eye size={16} strokeWidth={1.9} />
              {views.length}
              {views.length === 1 ? " view" : " views"}
            </span>
          </button>
        )}

        {viewers && (
          <div className="absolute inset-0 z-30 flex flex-col bg-black/70 backdrop-blur-sm">
            <button
              aria-label="Close viewers"
              onClick={() => setViewers(false)}
              className="flex-1"
            />
            <div className="max-h-[70%] overflow-y-auto rounded-t-[26px] bg-surface px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
              <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-ink/15" />
              <div className="flex items-center gap-5">
                {current.visibility === "public" && (
                  <span className="block">
                    <span className="block text-[16px] font-semibold text-ink">{publicViews}</span>
                    <span className="block text-[11.5px] text-ink-2">Public views</span>
                  </span>
                )}
                <span className="block">
                  <span className="block text-[16px] font-semibold text-ink">{privateViews}</span>
                  <span className="block text-[11.5px] text-ink-2">Private views</span>
                </span>
              </div>
              {views.length === 0 ? (
                <p className="mt-3 pb-2 text-[12px] text-ink-2">No views yet.</p>
              ) : (
                <ul className="mt-3 space-y-0.5">
                  {views.map((v, i) => (
                    <li key={`${v.username}-${v.at}`}>
                      <div className="flex items-center gap-3 py-3">
                        <Avatar name={v.name} seed={i} size={40} photo={v.photo} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-ink">
                            {v.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-ink-2">
                            {v.username}
                            {current.visibility === "public"
                              ? ` · ${v.audience === "public" ? "Public" : "Private"}`
                              : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-3">{viewedAt(v.at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
