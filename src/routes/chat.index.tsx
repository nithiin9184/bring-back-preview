import { useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  Archive,
  BellOff,
  Contact,
  Mail,
  MessageSquarePlus,
  Pin,
  RefreshCw,
  Search,
  Timer,
  Trash2,
  Users,
} from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";
import { GlassSheet } from "@/components/GlassSheet";
import { useApp, key as handleKey } from "@/lib/store";
import { AdSlot } from "@/components/AdSlot";
import { Check, X } from "lucide-react";
import type { ChatRow } from "@/data/types";

export const Route = createFileRoute("/chat/")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Chats — N Connect" },
      {
        name: "description",
        content: "All your end-to-end encrypted N Connect conversations in one clean list.",
      },
      { property: "og:title", content: "Chats — N Connect" },
      { property: "og:description", content: "All your encrypted conversations in one place." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { new?: true } =>
    search["new"] === true || search["new"] === "true" ? { new: true } : {},
  component: ChatsScreen,
});

type Status = "ready" | "loading" | "error";

function Row({
  chat,
  onOpen,
  onLongPress,
}: {
  chat: ChatRow;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const [dx, setDx] = useState(0);
  const startX = useRef(0);
  const dragging = useRef(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);

  const end = () => {
    if (press.current) clearTimeout(press.current);
    dragging.current = false;
    if (Math.abs(dx) > 70) onLongPress();
    setDx(0);
  };

  return (
    <li className="relative overflow-hidden">
      <span
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-4 text-ink-3 transition-opacity"
        style={{ opacity: Math.min(1, Math.abs(dx) / 60) }}
      >
        <Pin size={16} strokeWidth={1.8} />
        <Archive size={16} strokeWidth={1.8} />
      </span>
      <button
        onClick={onOpen}
        onPointerDown={(e) => {
          startX.current = e.clientX;
          dragging.current = true;
          press.current = setTimeout(onLongPress, 520);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const d = e.clientX - startX.current;
          if (Math.abs(d) > 6 && press.current) clearTimeout(press.current);
          setDx(Math.max(-110, Math.min(110, d)));
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={() => dragging.current && end()}
        className="relative flex w-full items-center gap-3 bg-background/0 py-3 text-left"
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: dx ? "none" : "transform 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <span className="relative shrink-0">
          <Avatar name={chat.name} seed={chat.name.length} size={50} />
          {chat.online && (
            <span className="absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              {chat.pinned && <Pin size={12} strokeWidth={2} className="shrink-0 text-ink-3" />}
              <span className="truncate text-[14px] font-semibold text-ink">{chat.name}</span>
              {chat.disappearing && (
                <Timer size={12} strokeWidth={2} className="shrink-0 text-ink-3" />
              )}
              {chat.muted && <BellOff size={12} strokeWidth={2} className="shrink-0 text-ink-3" />}
            </span>
            <span className="shrink-0 text-[11px] text-ink-3">{chat.time}</span>
          </span>

          <span className="mt-0.5 flex items-center justify-between gap-2">
            {chat.typing ? (
              <span className="truncate text-[12px] font-medium text-emerald-600">typing…</span>
            ) : (
              <span
                className={`truncate text-[12px] ${chat.unread ? "font-medium text-ink" : "text-ink-2"}`}
              >
                {chat.message}
              </span>
            )}
            {chat.unread ? (
              <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">
                {chat.unread}
              </span>
            ) : (
              <span className="shrink-0 text-[11px] text-ink-3">
                {chat.online ? "Active now" : chat.lastSeen}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}

function ChatsScreen() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const {
    chats: rows,
    people: contacts,
    requests,
    patchChat,
    removeChat,
    openChat,
    resolveRequest,
    startConversation,
    require: requireLimit,
    notify,
    chatFor,
  } = useApp();
  const [status, setStatus] = useState<Status>("ready");
  const [query, setQuery] = useState("");
  const [sheetFor, setSheetFor] = useState<ChatRow | null>(null);
  const [newChat, setNewChat] = useState(Boolean(search.new));
  const [groupSheet, setGroupSheet] = useState(false);
  const [requestsSheet, setRequestsSheet] = useState(false);

  const { visible, archived } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.message.toLowerCase().includes(q),
    );
    return {
      visible: filtered
        .filter((c) => !c.archived)
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
      archived: filtered.filter((c) => c.archived),
    };
  }, [rows, query]);

  const patch = patchChat;

  const reload = () => {
    setStatus("loading");
    setTimeout(() => setStatus("ready"), 900);
  };

  return (
    <main className="min-h-screen pb-28 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center justify-between gap-2">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Chats</h1>
          <div className="flex items-center gap-2">
            <button
              aria-label="New group"
              onClick={() => setGroupSheet(true)}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.98]"
            >
              <Users size={18} strokeWidth={1.8} />
            </button>
            <button
              aria-label="Message requests"
              onClick={() => setRequestsSheet(true)}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.98]"
            >
              <Mail size={18} strokeWidth={1.8} />
            </button>
            <button
              aria-label="New chat"
              onClick={() => setNewChat(true)}
              className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.98]"
            >
              <MessageSquarePlus size={18} strokeWidth={1.8} />
            </button>
          </div>
        </header>

        <div className="relative mt-4">
          <Search
            size={17}
            strokeWidth={1.8}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            className="h-11 w-full rounded-[23px] border border-line bg-surface pl-11 pr-4 text-[14px] text-ink shadow-soft outline-none placeholder:text-placeholder focus-blue"
          />
        </div>

        {status === "loading" && (
          <ul className="mt-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <span className="h-[50px] w-[50px] animate-pulse rounded-full bg-muted" />
                <span className="flex-1">
                  <span className="block h-3 w-1/3 animate-pulse rounded-full bg-muted" />
                  <span className="mt-2 block h-3 w-2/3 animate-pulse rounded-full bg-muted" />
                </span>
              </li>
            ))}
          </ul>
        )}

        {status === "error" && (
          <div className="mt-24 text-center">
            <p className="text-[13px] font-medium text-red-500">Couldn't load your chats</p>
            <p className="mt-1 text-[12px] text-ink-2">Check your connection and try again.</p>
            <button
              onClick={reload}
              className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-[21px] bg-brand px-5 text-[13px] font-semibold text-white active:scale-[0.98]"
            >
              <RefreshCw size={15} strokeWidth={1.9} />
              Retry
            </button>
          </div>
        )}

        {status === "ready" &&
          (visible.length === 0 ? (
            <div className="mt-24 text-center">
              <p className="text-[13px] font-medium text-ink">
                {query ? "No chats match your search" : "No conversations yet"}
              </p>
              <p className="mt-1 text-[12px] text-ink-2">
                Start an encrypted chat with someone you know.
              </p>
              <button
                onClick={() => setNewChat(true)}
                className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-[21px] bg-brand px-5 text-[13px] font-semibold text-white active:scale-[0.98]"
              >
                <MessageSquarePlus size={15} strokeWidth={1.9} />
                New Chat
              </button>
            </div>
          ) : (
            <ul className="mt-2">
              {visible.map((c, i) => (
                <div key={c.id}>
                  <Row
                    chat={c}
                    onOpen={() => {
                      openChat(c.username);
                      navigate({
                        to: "/chat/$username",
                        params: { username: handleKey(c.username) },
                      });
                    }}
                    onLongPress={() => setSheetFor(c)}
                  />
                  {i < visible.length - 1 && <span className="ml-[62px] block h-px bg-line/60" />}
                </div>
              ))}
            </ul>
          ))}

        {status === "ready" && archived.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-[13px] font-semibold text-ink-2">Archived</h2>
            <ul>
              {archived.map((c, i) => (
                <div key={c.id}>
                  <Row
                    chat={c}
                    onOpen={() => {
                      openChat(c.username);
                      navigate({
                        to: "/chat/$username",
                        params: { username: handleKey(c.username) },
                      });
                    }}
                    onLongPress={() => setSheetFor(c)}
                  />
                  {i < archived.length - 1 && <span className="ml-[62px] block h-px bg-line/60" />}
                </div>
              ))}
            </ul>
          </section>
        )}

        <AdSlot index={4} />
      </Screen>

      {/* Floating Contacts action */}
      <Link
        to="/contacts"
        aria-label="Contacts"
        className="fixed right-5 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-soft transition-transform active:scale-[0.97]"
      >
        <Contact size={22} strokeWidth={1.9} />
      </Link>

      <GlassSheet
        open={Boolean(sheetFor)}
        title={sheetFor?.name}
        onClose={() => setSheetFor(null)}
        actions={
          sheetFor
            ? [
                {
                  label: sheetFor.pinned ? "Unpin chat" : "Pin chat",
                  Icon: Pin,
                  onSelect: () => patch(sheetFor.id, { pinned: !sheetFor.pinned }),
                },
                {
                  label: sheetFor.muted ? "Unmute" : "Mute",
                  Icon: BellOff,
                  onSelect: () => patch(sheetFor.id, { muted: !sheetFor.muted }),
                },
                {
                  label: sheetFor.archived ? "Unarchive" : "Archive",
                  Icon: Archive,
                  onSelect: () => patch(sheetFor.id, { archived: !sheetFor.archived }),
                },
                {
                  label: "Delete chat",
                  Icon: Trash2,
                  tone: "danger",
                  onSelect: () => {
                    removeChat(sheetFor.id);
                    notify("Chat deleted");
                  },
                },
              ]
            : []
        }
      />

      <GlassSheet
        open={newChat}
        title="Start a new chat"
        onClose={() => setNewChat(false)}
        actions={contacts.slice(0, 6).map((p) => ({
          label: p.name,
          Icon: MessageSquarePlus,
          onSelect: () => {
            const existing = chatFor(p.username);
            if (existing) {
              navigate({ to: "/chat/$username", params: { username: handleKey(p.username) } });
              return;
            }
            if (!startConversation(p, "Hi! I'd like to connect.")) return;
            navigate({ to: "/chat/$username", params: { username: handleKey(p.username) } });
          },
        }))}
      >
        {contacts.length === 0 && (
          <p className="px-3.5 py-3 text-[13px] text-ink-2">No contacts yet.</p>
        )}
      </GlassSheet>

      <GlassSheet
        open={groupSheet}
        title="New group"
        onClose={() => setGroupSheet(false)}
        actions={contacts.slice(0, 5).map((p) => ({
          label: p.name,
          Icon: Users,
          onSelect: () => {
            setGroupSheet(false);
            if (!requireLimit("initiateMessage")) return;
            notify(`${p.name} added to a new group`);
          },
        }))}
      >
        {contacts.length === 0 && (
          <p className="px-3.5 py-3 text-[13px] text-ink-2">No people to add yet.</p>
        )}
      </GlassSheet>

      <GlassSheet
        open={requestsSheet}
        title="Message requests"
        onClose={() => setRequestsSheet(false)}
      >
        {requests.length === 0 ? (
          <p className="px-3.5 py-3 text-[13px] text-ink-2">No message requests.</p>
        ) : (
          <ul className="max-h-[46vh] overflow-y-auto px-1.5">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-2 py-2.5">
                <Avatar name={r.name} seed={r.name.length} size={40} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {r.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-2">{r.preview}</span>
                  <span className="block truncate text-[11px] text-ink-3">
                    {r.direction === "outgoing" ? "Waiting for them to accept" : r.time}
                  </span>
                </span>
                {r.direction === "incoming" ? (
                  <>
                    <button
                      aria-label={`Accept ${r.name}`}
                      onClick={() => {
                        resolveRequest(r.id, true);
                        notify("Request accepted");
                      }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-white"
                    >
                      <Check size={15} strokeWidth={2.2} />
                    </button>
                    <button
                      aria-label={`Reject ${r.name}`}
                      onClick={() => {
                        resolveRequest(r.id, false);
                        notify("Request rejected");
                      }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-ink-2"
                    >
                      <X size={15} strokeWidth={2.2} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      resolveRequest(r.id, false);
                      notify("Request withdrawn");
                    }}
                    className="h-8 shrink-0 rounded-full border border-line px-3 text-[12px] font-semibold text-ink-2"
                  >
                    Withdraw
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassSheet>

      <BottomNav />
    </main>
  );
}
