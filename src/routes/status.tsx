import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CircleDot, Image as ImageIcon, Plus, Type, Video, X } from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";
import { StatusComposer, type StatusDraft } from "@/components/status/StatusComposer";
import { StatusViewer } from "@/components/status/StatusViewer";
import { StatusRing, type StatusRingState } from "@/components/status/StatusRing";
import { useApp } from "@/lib/store";
import type { StatusEntry } from "@/data/types";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "Status — N Connect" },
      {
        name: "description",
        content: "Share a status update that disappears after 24 hours on N Connect.",
      },
      { property: "og:title", content: "Status — N Connect" },
      { property: "og:description", content: "Status updates that disappear after 24 hours." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StatusScreen,
});

function timeAgo(ts: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

/** Blue ring before viewing, gray once viewed, no ring when nothing is live. */
function StatusAvatar({
  name,
  photo,
  ring,
}: {
  name: string;
  photo?: string | undefined;
  ring: StatusRingState;
}) {
  return (
    <StatusRing state={ring} size={52}>
      <Avatar name={name || "N"} seed={(name || "N").length} size={44} photo={photo} />
    </StatusRing>
  );
}

type Viewing = {
  entries: StatusEntry[];
  ownerName: string;
  ownerPhoto?: string | undefined;
  canDelete: boolean;
};

function StatusScreen() {
  const {
    me,
    statuses,
    myStatuses,
    seenStatus,
    statusRing,
    addStatus,
    deleteStatus,
    markStatusSeen,
    notify,
  } = useApp();
  const [compose, setCompose] = useState(false);
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  const [composeType, setComposeType] = useState<"text" | "media">("text");
  const [selector, setSelector] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recordRef = useRef<HTMLInputElement>(null);

  // One row per author, newest first.
  const rows = useMemo(() => {
    const byAuthor = new Map<string, StatusEntry[]>();
    statuses.forEach((s) => {
      const k = s.authorUsername.toLowerCase();
      byAuthor.set(k, [...(byAuthor.get(k) ?? []), s]);
    });
    return [...byAuthor.values()].map((list) => ({
      latest: list[0] as StatusEntry,
      entries: list,
      count: list.length,
      unseen: list.some((s) => !seenStatus.includes(s.id)),
    }));
  }, [statuses, seenStatus]);

  // View counts of the newest own status, split by how viewers reached it.
  const myCounts = useMemo(() => {
    const latest = myStatuses[0];
    const views = latest?.views ?? [];
    const priv = views.filter((v) => v.audience !== "public").length;
    const pub = views.length - priv;
    if (!latest) return { label: "", pub: 0, priv: 0 };
    const label =
      latest.visibility === "public"
        ? `${pub} public · ${priv} private views`
        : `${priv} private view${priv === 1 ? "" : "s"}`;
    return { label, pub, priv };
  }, [myStatuses]);

  // Media shared into N Connect from another app opens the same creation flow.
  useEffect(() => {
    const openWith = (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) return;
      setSharedFile(file);
      setComposeType("media");
      setCompose(true);
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      e.preventDefault();
      openWith(file);
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onPaste = (e: ClipboardEvent) => openWith(e.clipboardData?.files?.[0]);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("paste", onPaste);

    // Progressive Web App share / file handling entry point.
    const queue = (
      window as unknown as {
        launchQueue?: {
          setConsumer: (cb: (p: { files?: FileSystemFileHandle[] }) => void) => void;
        };
      }
    ).launchQueue;
    queue?.setConsumer(async (params) => {
      const handle = params.files?.[0];
      if (!handle) return;
      openWith(await handle.getFile());
    });

    return () => {
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("paste", onPaste);
    };
  }, []);

  const openSelector = () => {
    if (!me.username) {
      notify("Create your account first");
      return;
    }
    setSelector(true);
  };

  const openTextComposer = () => {
    setSelector(false);
    setSharedFile(null);
    setComposeType("text");
    setCompose(true);
  };

  const openPickedFile = (file: File | undefined) => {
    if (!file) return;
    setSelector(false);
    setSharedFile(file);
    setComposeType("media");
    setCompose(true);
  };

  const post = (draft: StatusDraft) => {
    if (!me.username) {
      notify("Create your account first");
      return;
    }
    addStatus(draft);
    notify("Status shared for 24 hours");
  };

  const openMine = () => {
    if (myStatuses.length === 0) {
      openSelector();
      return;
    }
    setViewing({
      entries: [...myStatuses].reverse(),
      ownerName: me.name,
      ownerPhoto: me.photo,
      canDelete: true,
    });
  };

  const openAuthor = (entries: StatusEntry[]) => {
    setViewing({
      entries: [...entries].reverse(),
      ownerName: entries[0]?.authorName ?? "Status",
      ownerPhoto: undefined,
      canDelete: false,
    });
  };

  return (
    <main className="min-h-screen pb-28 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Status</h1>
        </header>

        <section className="relative mt-4 flex items-center">
          <button onClick={openMine} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left">
            <span className="relative">
              <StatusAvatar name={me.name} photo={me.photo} ring={statusRing(me.username)} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {myStatuses.length > 0
                  ? `My Status · ${myStatuses.length} update${myStatuses.length > 1 ? "s" : ""}`
                  : "My Status"}
              </span>
              <span className="block truncate text-[11.5px] text-ink-2">
                {myStatuses[0]
                  ? `${myCounts.label} · ${timeAgo(myStatuses[0].createdAt)}`
                  : "Tap to add status update"}
              </span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Add to My Status"
            onClick={openSelector}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-brand transition-colors active:bg-muted"
          >
            <Plus size={20} strokeWidth={2.2} />
          </button>
        </section>

        <section className="mt-6">
          <h2 className="text-[13px] font-semibold text-ink">Recent updates</h2>
          {rows.length === 0 ? (
            <p className="mt-2 text-[12px] leading-[1.6] text-ink-2">
              No status updates yet. Updates from people you're allowed to see appear here and
              disappear after 24 hours.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {rows.map(({ latest, entries, count }) => (
                <li key={latest.id}>
                  <button
                    onClick={() => openAuthor(entries)}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <StatusAvatar
                      name={latest.authorName}
                      ring={statusRing(latest.authorUsername)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">
                        {latest.authorName}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-2">
                        {timeAgo(latest.createdAt)}
                        {count > 1 ? ` · ${count} updates` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Screen>

      <button
        aria-label="Add status"
        onClick={openSelector}
        className="fixed bottom-24 right-[max(20px,calc((100vw-430px)/2+20px))] z-30 grid h-[58px] w-[58px] place-items-center rounded-full bg-brand text-background shadow-glass transition-transform active:scale-95"
      >
        <Plus size={23} strokeWidth={2} />
      </button>

      {selector && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/30 px-3" onClick={() => setSelector(false)}>
          <section
            aria-label="Choose status type"
            className="mb-[max(12px,env(safe-area-inset-bottom))] w-full max-w-[410px] rounded-[18px] bg-surface px-4 pb-4 pt-3 shadow-glass"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-ink">Create Status</h2>
              <button aria-label="Close" onClick={() => setSelector(false)} className="grid h-9 w-9 place-items-center rounded-full text-ink-2">
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { label: "Image", Icon: ImageIcon, action: () => imageRef.current?.click() },
                { label: "Video", Icon: Video, action: () => videoRef.current?.click() },
                { label: "Text", Icon: Type, action: openTextComposer },
                { label: "Record", Icon: CircleDot, action: () => recordRef.current?.click() },
              ].map(({ label, Icon, action }) => (
                <button key={label} onClick={action} className="flex min-w-0 flex-col items-center gap-2 py-2 text-ink">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-muted">
                    <Icon size={19} strokeWidth={1.8} />
                  </span>
                  <span className="text-[11.5px] font-medium">{label}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={(e) => { openPickedFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={(e) => { openPickedFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={recordRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => { openPickedFile(e.target.files?.[0]); e.target.value = ""; }} />

      <StatusComposer
        open={compose}
        incomingFile={sharedFile}
        initialStage={composeType}
        onClose={() => {
          setCompose(false);
          setSharedFile(null);
        }}
        onPost={post}
      />

      {viewing && (
        <StatusViewer
          entries={viewing.entries}
          ownerName={viewing.ownerName}
          ownerPhoto={viewing.ownerPhoto}
          canDelete={viewing.canDelete}
          onSeen={markStatusSeen}
          onDelete={(id) => {
            deleteStatus(id);
            notify("Status removed");
            setViewing((v) => {
              if (!v) return null;
              const rest = v.entries.filter((e) => e.id !== id);
              return rest.length ? { ...v, entries: rest } : null;
            });
          }}
          onClose={() => setViewing(null)}
        />
      )}

      <BottomNav />
    </main>
  );
}
