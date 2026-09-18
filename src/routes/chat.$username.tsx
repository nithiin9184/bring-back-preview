import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  Copy,
  CornerUpLeft,
  Flag,
  Forward,
  Image as ImageIcon,
  Mic,
  MoreVertical,
  Pencil,
  Phone,
  PhoneOff,
  Plus,
  Reply,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smile,
  Timer,
  Trash2,
  UserRound,
  UserX,
  Video,
  X,
} from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import { GlassSheet } from "@/components/GlassSheet";
import { useCall } from "@/lib/calls/call-provider";
import chatPetals from "@/assets/chat-petals.jpg";
import { useApp, key as handleKey } from "@/lib/store";
import { bubbleStyle, chatFontStack, resolvedChatFont } from "@/lib/appearance/chat-style";
import { findOwnMessageId, sendMessageToBackend } from "@/lib/events/realtime-events";
import { usePeerProfile } from "@/lib/profiles/profile-repository";
import { useServerFn } from "@tanstack/react-start";
import { notifyMessageRequest } from "@/lib/notifications/notifications.functions";
import {
  attachImagesToMessage,
  denialMessages,
  isImageReference,
  purgeExpiredImages,
  removeChatImages,
  resolveChatImageUrls,
  uploadChatImages,
} from "@/lib/chat/media-repository";
import { resolveAppearanceBackground } from "@/lib/appearance/background-repository";

export const Route = createFileRoute("/chat/$username")({
  head: ({ params }) => {
    // The page title uses the handle from the URL: a peer's name is a server
    // record that head() cannot read.
    const name = `@${params.username.replace(/^@/, "")}`;
    return {
      meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { title: `${name} — N Connect Chat` },
        {
          name: "description",
          content: `Your end-to-end encrypted conversation with ${name} on N Connect.`,
        },
        { property: "og:title", content: `${name} — N Connect Chat` },
        { property: "og:description", content: `Encrypted conversation with ${name}.` },
      ],
    };
  },
  component: ConversationScreen,
});

type Peer = {
  name: string;
  username: string;
  online: boolean;
  lastSeen: string;
  known: boolean;
};

/**
 * Resolve the other person from the account's own chat row, falling back to the
 * server profile record. Returns null when the person cannot be resolved, so the
 * screen shows its unavailable state instead of inventing a peer.
 */
function lookup(
  chat?: { name: string; username: string; online: boolean; lastSeen?: string },
  profile?: { name: string; username: string } | undefined,
): Peer | null {
  if (chat) {
    return {
      name: chat.name,
      username: chat.username,
      online: chat.online,
      lastSeen: chat.lastSeen ?? "",
      known: true,
    };
  }
  if (!profile) return null;
  return {
    name: profile.name,
    username: profile.username,
    online: false,
    lastSeen: "",
    known: true,
  };
}

type State = "sent" | "delivered" | "read";

type Msg = {
  id: string;
  mine: boolean;
  text?: string | undefined;
  images?: string[] | undefined;
  time: string;
  state?: State | undefined;
  reaction?: string | undefined;
  replyTo?: string | undefined;
  edited?: boolean | undefined;
  deleted?: boolean | undefined;
};

const reactions = ["❤️", "😂", "👍", "🔥", "😮", "🙏"];

function StateTick({ state }: { state?: State | undefined }) {
  if (!state) return null;
  const cls = state === "read" ? "text-brand" : "text-ink-3";
  return (
    <span className="ml-0.5 inline-flex w-[18px] shrink-0 items-center justify-end">
      {state === "sent" ? (
        <Check size={13} strokeWidth={2} className={cls} />
      ) : (
        <CheckCheck size={14} strokeWidth={2} className={cls} />
      )}
    </span>
  );
}

function ChatUnavailable({ username }: { username: string }) {
  const navigate = useNavigate();
  return (
    <main className="min-h-screen pt-[max(18px,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-[430px] px-4">
        <button
          aria-label="Back"
          onClick={() => navigate({ to: "/chat", search: {} })}
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
        >
          <ChevronLeft size={19} strokeWidth={1.9} />
        </button>
        <h1 className="mt-5 text-[18px] font-semibold text-ink">Chat unavailable</h1>
        <p className="mt-1 text-[12px] text-ink-2">
          We couldn't find @{username.replace(/^@/, "")} on N Connect.
        </p>
      </div>
    </main>
  );
}

function ConversationScreen() {
  const { username } = Route.useParams();
  const { ready, chatFor, contacts } = useApp();
  const chat = chatFor(username);
  const saved = contacts.find((c) => handleKey(c.username) === handleKey(username));
  // The other person's profile is a server record, read here when this account
  // has no chat row or saved contact for them yet.
  const { profile, loading } = usePeerProfile(username);
  const peer = useMemo(() => {
    const found = lookup(
      chat,
      profile?.name || profile?.username
        ? { name: profile.name || profile.username, username: profile.username }
        : undefined,
    );
    if (found) return found;
    // A saved contact can be opened before any message exists between you.
    if (saved)
      return {
        name: saved.name,
        username: saved.username,
        online: false,
        lastSeen: "",
        known: true,
      };
    return null;
  }, [chat, saved, profile]);
  if (!ready || loading) return null;
  if (!peer) return <ChatUnavailable username={username} />;
  return <Conversation peer={peer} />;
}

function Conversation({ peer }: { peer: Peer }) {
  const { username } = Route.useParams();
  const navigate = useNavigate();
  const notifyMessageRequestFn = useServerFn(notifyMessageRequest);
  const {
    me,
    chatFor,
    messagesFor,
    appendMessage,
    updateMessages,
    openChat,
    patchChat,
    removeChat,
    require: requireLimit,
    check,
    countImages,
    limits,
    isBlocked,
    blockPerson,
    unblock,
    blocked: blockedList,
    reportUser,
    settings,
    imagesLeft,
    mediaUnlocked,
    trustOf,
    trustUser,
    untrustUser,
    chatUnlocked,
    contactRequestPending,
    startConversation,
    loadHistory,
    draftFor,
    saveDraft,
  } = useApp();
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState("");

  useEffect(() => {
    let active = true;
    if (settings.background !== "Custom Image" || !settings.customBackgroundPath) {
      setCustomBackgroundUrl("");
      return;
    }
    void resolveAppearanceBackground(settings.customBackgroundPath).then((url) => {
      if (active) setCustomBackgroundUrl(url ?? "");
    });
    return () => {
      active = false;
    };
  }, [settings.background, settings.customBackgroundPath]);

  // Images, voice and video stay locked until BOTH people trust each other.
  const trust = trustOf(username);
  const mediaOn = mediaUnlocked(username);

  const chat = chatFor(username);
  const msgs = messagesFor(username) as Msg[];
  const setMsgs = (fn: (list: Msg[]) => Msg[]) => updateMessages(username, fn as never);
  // The unsent text belongs to the account, so it is still here on another
  // device or after a reinstall. This is the copy being typed right now.
  const savedDraft = draftFor(username);
  const [draft, setDraftLocal] = useState(savedDraft);
  const setDraft = useCallback(
    (next: string | ((current: string) => string)) => {
      setDraftLocal((current) => {
        const value = typeof next === "function" ? next(current) : next;
        saveDraft(username, value);
        return value;
      });
    },
    [saveDraft, username],
  );
  // Picks up the stored text once the account has loaded, and when switching
  // conversations, without overwriting text already being typed.
  useEffect(() => {
    setDraftLocal((current) => (current.length === 0 ? savedDraft : current));
  }, [savedDraft, username]);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editing, setEditing] = useState<Msg | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sheetFor, setSheetFor] = useState<Msg | null>(null);
  const [menu, setMenu] = useState(false);
  const [attach, setAttach] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [disappearSheet, setDisappearSheet] = useState(false);
  const [reportSheet, setReportSheet] = useState(false);
  const [deleteChatSheet, setDeleteChatSheet] = useState(false);
  const [blockSheet, setBlockSheet] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [mediaOpen, setMediaOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { startCall: placeCall } = useCall();
  const muted = Boolean(chat?.muted);
  const setMuted = (v: boolean) => chat && patchChat(chat.id, { muted: v });
  const blocked = isBlocked(username);
  const setBlocked = (v: boolean) => {
    if (v) {
      blockPerson({ id: chat?.id ?? `b${Date.now()}`, name: peer.name, username: peer.username });
    } else {
      const row = blockedList.find((b) => handleKey(b.username) === handleKey(username));
      if (row) unblock(row.id);
    }
  };
  const [timer, setTimer] = useState(chat?.disappearing ? settings.defaultDisappearing : "Off");
  // Picked photos live only in memory until they are uploaded to private storage.
  const [pending, setPending] = useState<{
    files: File[];
    previews: string[];
    caption: string;
    expiresInHours?: number;
  } | null>(null);
  const [sending, setSending] = useState(false);
  // Short-lived viewing links for stored photo references, resolved on demand.
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const requestedRefs = useRef<Set<string>>(new Set());
  const disappearingPick = useRef(false);
  const [peerTyping] = useState(false);
  const [toast, setToast] = useState("");
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [viewportTop, setViewportTop] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Opens the device photo picker; selected photos are real files, not samples.
  const pickPhotos = (multiple: boolean, disappearing = false) => {
    if (!mediaOn) {
      setAttach(false);
      setToast("Photos unlock when you both trust each other");
      return;
    }
    disappearingPick.current = disappearing;
    const input = fileRef.current;
    if (!input) return;
    input.multiple = multiple;
    input.click();
  };

  const onPickedFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files);
    const previews = picked.map((f) => `url(${URL.createObjectURL(f)})`);
    const expiry = disappearingPick.current ? { expiresInHours: 24 } : {};
    setAttach(false);
    setPending((p) =>
      p
        ? { ...p, files: [...p.files, ...picked], previews: [...p.previews, ...previews] }
        : { files: picked, previews, caption: "", ...expiry },
    );
  };

  /** Turns a stored photo reference into something the UI can paint. */
  const bg = (value: string): string | undefined =>
    isImageReference(value) ? imageUrls[value] && `url("${imageUrls[value]}")` : value;

  useEffect(() => {
    const viewport = window.visualViewport;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";

    // Pin the shell to the *visual* viewport: when the keyboard opens the shell
    // shrinks and follows the visible area, so the header stays put at the top
    // and only the message list + composer shift above the keyboard.
    const syncViewport = () => {
      setViewportHeight(Math.round(viewport?.height ?? window.innerHeight));
      setViewportTop(Math.round(viewport?.offsetTop ?? 0));
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);

    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
    };
  }, []);

  useEffect(() => {
    const input = composerRef.current;
    if (!input) return;
    input.style.height = "44px";
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  }, [draft]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  // Mark the conversation read on open and pull the stored conversation, which
  // is the authority; what was already on screen is only a fast first paint.
  useEffect(() => {
    openChat(username);
    void loadHistory(username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Clear photos whose disappearing window has passed, then keep viewing links
  // fresh for every stored photo reference in this conversation.
  useEffect(() => {
    void purgeExpiredImages();
  }, []);

  useEffect(() => {
    const refs = msgs
      .flatMap((m) => m.images ?? [])
      .filter((r) => isImageReference(r) && !requestedRefs.current.has(r));
    if (refs.length === 0) return;
    refs.forEach((r) => requestedRefs.current.add(r));
    let active = true;
    void resolveChatImageUrls(refs).then((urls) => {
      if (active && Object.keys(urls).length > 0) setImageUrls((prev) => ({ ...prev, ...urls }));
    });
    return () => {
      active = false;
    };
  }, [msgs]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1500);
    return () => clearTimeout(t);
  }, [toast]);

  const status = blocked
    ? "You blocked this account"
    : peerTyping
      ? "typing…"
      : peer.online
        ? "Online"
        : peer.lastSeen;

  const now = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const push = (m: Omit<Msg, "id" | "time">, withId?: string) => {
    const id = withId ?? `x${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
    appendMessage(username, { ...m, id, time: now() } as never);
    // Deliver through the backend so the other person receives it live.
    void sendMessageToBackend({
      toUsername: username,
      clientId: id,
      text: m.text,
      images: m.images,
      replyTo: m.replyTo,
    }).then(async (ok) => {
      // Attach the uploaded photos to the stored message once it exists.
      if (!ok || !m.images?.length) return;
      const messageId = await findOwnMessageId(id);
      if (messageId) await attachImagesToMessage(id, messageId);
    });
  };

  const canSend = () => {
    if (blocked) {
      setToast("Unblock to send messages");
      return false;
    }
    // An unanswered contact request unlocks nothing — no chat, media or calls.
    if (contactRequestPending(username) && !chatUnlocked(username)) {
      setToast("They haven't accepted your contact request yet");
      return false;
    }
    // A brand new conversation is a message request: Free can't start one.
    if (!chat && !requireLimit("initiateMessage")) return false;
    return true;
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (!editing && !canSend()) return;
    if (editing) {
      setMsgs((l) => l.map((m) => (m.id === editing.id ? { ...m, text, edited: true } : m)));
      setEditing(null);
      setDraft("");
      return;
    }
    // The first message to someone who hasn't accepted yet (for example a saved
    // contact) reaches them as a Message Request.
    if (!chat && !chatUnlocked(username)) {
      const sent = startConversation(
        {
          id: `p${Date.now()}`,
          name: peer.name,
          username: peer.username,
          location: "",
          state: "follow",
        },
        text,
      );
      if (!sent) return;
      // The request reaches the other person through the backend.
      const requestId = `x${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
      void sendMessageToBackend({ toUsername: username, clientId: requestId, text }).then((ok) => {
        if (!ok) return;
        // The other person is told on the server, which honours their settings.
        void notifyMessageRequestFn({ data: { peerUsername: username } }).catch(() => undefined);
      });
      setDraft("");
      setReplyTo(null);
      setToast("Message request sent");
      return;
    }
    push({
      mine: true,
      text,
      state: "sent",
      ...(replyTo?.text ? { replyTo: replyTo.text } : {}),
    });
    setDraft("");
    setReplyTo(null);
  };

  const sendImages = async () => {
    if (!pending || sending) return;
    if (!canSend()) return;
    // Every image counts individually toward the daily limit.
    if (!requireLimit("images", pending.files.length)) return;
    const count = pending.files.length;
    const clientId = `x${Date.now()}${Math.random().toString(16).slice(2, 6)}`;
    setSending(true);
    try {
      // Photos are compressed, uploaded to private storage and authorized by
      // the backend (Trust, Block, Message Request and the daily allowance).
      const result = await uploadChatImages({
        peerUsername: username,
        clientId,
        files: pending.files,
        expiresInHours: pending.expiresInHours,
      });
      if (!result.ok) {
        setToast(
          result.reason === "offline"
            ? "You're offline — photos will send when you reconnect"
            : denialMessages[result.reason],
        );
        return;
      }
      countImages(count);
      push(
        {
          mine: true,
          images: result.references,
          state: "sent",
          ...(pending.caption.trim() ? { text: pending.caption.trim() } : {}),
        },
        clientId,
      );
      pending.previews.forEach((preview) => {
        const url = preview.slice(4, -1);
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      setPending(null);
      setToast(`${imagesLeft - count} images left today`);
    } catch {
      setToast("Photos couldn't be sent. Please try again.");
    } finally {
      setSending(false);
    }
  };

  // Calls: the backend owns every Free/Premium rule (daily calls, per-call
  // length and daily minutes) and the call service owns the WebRTC session.
  const startCall = () => {
    if (blocked) {
      setToast("Unblock to call");
      return;
    }
    if (!mediaOn) {
      setToast("Voice calls unlock when you both trust each other");
      return;
    }
    placeCall({ name: peer.name, username: peer.username }, "voice");
  };

  const startVideoCall = () => {
    if (blocked) {
      setToast("Unblock to call");
      return;
    }
    if (!mediaOn) {
      setToast("Video calls unlock when you both trust each other");
      return;
    }
    placeCall({ name: peer.name, username: peer.username }, "video");
  };

  const toggleSelect = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const media = msgs.flatMap((m) => m.images ?? []);
  const matches = msgs.filter(
    (m) => searchQ.trim() && m.text?.toLowerCase().includes(searchQ.trim().toLowerCase()),
  );
  const bubbleShape =
    settings.bubble === "Square"
      ? "rounded-[5px]"
      : settings.bubble === "Soft"
        ? "rounded-[12px]"
        : "rounded-[20px]";
  const messageTextSize =
    settings.textSize === "Small"
      ? "text-[12px]"
      : settings.textSize === "Large"
        ? "text-[15px]"
        : "text-[13.5px]";
  const backgroundImage =
    settings.background === "Custom Image" && customBackgroundUrl
      ? `url(${customBackgroundUrl})`
      : settings.background === "Petals"
        ? `url(${chatPetals})`
        : "none";
  const backgroundColor =
    settings.background === "Peach"
      ? "var(--peach)"
      : settings.background === "Sky"
        ? "var(--sky)"
        : settings.background === "Plain"
          ? "var(--muted)"
          : undefined;

  /* --------------- Conversation --------------- */

  return (
    <main
      className={`fixed inset-x-0 top-0 flex h-dvh touch-manipulation flex-col overflow-hidden ${settings.reduceMotion ? "chat-reduce-motion" : ""}`}
      style={{
        ...(viewportHeight ? { height: `${viewportHeight}px` } : {}),
        transform: `translateY(${viewportTop}px)`,
        backgroundImage,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundColor,
      }}
    >
      {/* Header */}
      <header className="z-20 shrink-0 pt-[max(10px,env(safe-area-inset-top))]">
        <div className="mx-auto w-full max-w-[430px] px-3 pb-2">
          {selected.length > 0 ? (
            <div className="glass flex h-[56px] items-center gap-2 rounded-[26px] px-2.5">
              <button
                aria-label="Clear selection"
                onClick={() => setSelected([])}
                className="grid h-9 w-9 place-items-center rounded-full text-ink"
              >
                <X size={19} strokeWidth={1.9} />
              </button>
              <p className="flex-1 text-[14px] font-semibold text-ink">
                {selected.length} selected
              </p>
              <button
                aria-label="Copy"
                onClick={async () => {
                  const text = msgs
                    .filter((m) => selected.includes(m.id) && m.text)
                    .map((m) => m.text as string)
                    .join("\n");
                  const ok = await copyText(text);
                  setToast(ok ? "Copied" : "Nothing to copy");
                  if (ok) setSelected([]);
                }}
                className="grid h-9 w-9 place-items-center rounded-full text-ink"
              >
                <Copy size={18} strokeWidth={1.8} />
              </button>
              <button
                aria-label="Forward"
                onClick={() => setForwarding(true)}
                className="grid h-9 w-9 place-items-center rounded-full text-ink"
              >
                <Forward size={18} strokeWidth={1.8} />
              </button>
              <button
                aria-label="Delete"
                onClick={() => {
                  setMsgs((l) => l.filter((m) => !selected.includes(m.id)));
                  setSelected([]);
                }}
                className="grid h-9 w-9 place-items-center rounded-full text-red-500"
              >
                <Trash2 size={18} strokeWidth={1.8} />
              </button>
            </div>
          ) : (
            <div className="flex h-[58px] items-center gap-1.5">
              <button
                aria-label="Back"
                onClick={() => navigate({ to: "/chat", search: {} })}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.97]"
              >
                <ChevronLeft size={20} strokeWidth={1.9} />
              </button>

              <button
                onClick={() =>
                  navigate({
                    to: "/profile/$username",
                    params: { username: handleKey(peer.username) },
                  })
                }
                aria-label={`Open ${peer.name}'s profile`}
                className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-2.5 text-left shadow-soft active:opacity-70"
              >
                <span className="relative shrink-0">
                  <Avatar name={peer.name} seed={7} size={34} />
                  {peer.online && !blocked && (
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[14px] font-semibold text-ink">{peer.name}</span>
                    {muted && <BellOff size={12} strokeWidth={2} className="shrink-0 text-ink-3" />}
                    {timer !== "Off" && (
                      <Timer size={12} strokeWidth={2} className="shrink-0 text-ink-3" />
                    )}
                  </span>
                  <span
                    className={`block truncate text-[11px] ${
                      peerTyping ? "font-medium text-emerald-600" : "text-ink-2"
                    }`}
                  >
                    {status}
                  </span>
                </span>
              </button>

              <button
                aria-label="Voice call"
                onClick={startCall}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.97]"
              >
                <Phone size={18} strokeWidth={1.8} />
              </button>
              <button
                aria-label="Video call"
                onClick={startVideoCall}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.97]"
              >
                <Video size={18} strokeWidth={1.8} />
              </button>
              <button
                aria-label="More"
                onClick={() => setMenu(true)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.97]"
              >
                <MoreVertical size={18} strokeWidth={1.8} />
              </button>
            </div>
          )}

          {searchOpen && (
            <div className="glass mt-2 rounded-[22px] p-2">
              <div className="relative">
                <Search
                  size={16}
                  strokeWidth={1.8}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
                />
                <input
                  autoFocus
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Search in this chat"
                  className="h-10 w-full rounded-[20px] border border-line bg-surface pl-10 pr-10 text-[13.5px] text-ink outline-none placeholder:text-placeholder focus-blue"
                />
                <button
                  aria-label="Close search"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQ("");
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-2"
                >
                  <X size={16} strokeWidth={1.9} />
                </button>
              </div>
              {searchQ.trim() && (
                <p className="px-2 pt-2 text-[11.5px] text-ink-2">
                  {matches.length} {matches.length === 1 ? "result" : "results"}
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Messages */}
      <section
        className="no-scrollbar mx-auto min-h-0 w-full max-w-[430px] flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
        style={{
          fontFamily: chatFontStack(
            resolvedChatFont(settings.chatFont, limits.chatCustomization),
          ),
        }}
      >
        <p className="my-3 text-center text-[11px] text-ink-2">
          Messages are end-to-end encrypted. Only you and {peer.name} can read them.
        </p>
        {timer !== "Off" && (
          <p className="mb-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-2">
            <Timer size={12} strokeWidth={2} />
            Disappearing messages: {timer}
          </p>
        )}

        <ul className="space-y-1.5">
          {msgs.map((m) => {
            const hit =
              Boolean(searchQ.trim()) &&
              Boolean(m.text?.toLowerCase().includes(searchQ.trim().toLowerCase()));
            const picked = selected.includes(m.id);
            return (
              <li key={m.id} className={m.mine ? "flex justify-end" : "flex justify-start"}>
                <button
                  onClick={() => selected.length > 0 && toggleSelect(m.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSheetFor(m);
                  }}
                  onDoubleClick={() => toggleSelect(m.id)}
                  className={`max-w-[78%] text-left ${picked ? "opacity-100" : ""}`}
                  style={{ touchAction: "manipulation" }}
                >
                  <span
                    className={`relative block px-3 py-2 shadow-soft ${bubbleShape} ${
                      m.mine
                        ? settings.bubble === "Rounded" ? "rounded-br-[7px]" : ""
                        : settings.bubble === "Rounded" ? "rounded-bl-[7px] border border-white/80" : "border border-white/80"
                    } ${picked ? "ring-2 ring-brand" : ""} ${hit ? "ring-2 ring-amber-300" : ""}`}
                    style={bubbleStyle(settings.bubbleColour, m.mine, limits.chatCustomization)}
                  >
                    {m.replyTo && (
                      <span
                        className={`mb-1.5 block truncate rounded-[12px] border-l-2 px-2 py-1 text-[11.5px] ${
                          m.mine
                            ? "border-background/50 bg-white/15 text-background/85"
                            : "border-ink/25 bg-muted text-ink-2"
                        }`}
                      >
                        {m.replyTo}
                      </span>
                    )}

                    {m.images && (
                      <span
                        className={`mb-1 grid gap-1 ${m.images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
                      >
                        {m.images.map((g, i) => (
                          <span
                            key={i}
                            className="block h-[104px] w-full rounded-[14px] bg-muted"
                            style={{
                              backgroundImage: bg(g),
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                        ))}
                      </span>
                    )}

                    {m.deleted ? (
                      <span className="block text-[13px] italic opacity-70">
                        This message was deleted
                      </span>
                    ) : (
                      m.text && <span className={`block leading-snug ${messageTextSize}`}>{m.text}</span>
                    )}

                    <span
                      className={`mt-1 flex items-center justify-end gap-1 text-[10.5px] ${
                        m.mine ? "text-background/70" : "text-ink-3"
                      }`}
                    >
                      {m.edited && <span>edited</span>}
                      {m.time}
                      {m.mine && <StateTick state={m.state} />}
                    </span>

                    {m.reaction && (
                      <span className="absolute -bottom-2.5 left-2 rounded-full border border-line bg-surface px-1.5 text-[11px] shadow-soft">
                        {m.reaction}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {peerTyping && (
          <div className="mt-2 flex items-center gap-1.5 rounded-[18px] border border-white/80 bg-white/90 px-3 py-2 w-fit shadow-soft">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full bg-ink-3 ${settings.reduceMotion ? "" : "animate-pulse"}`}
                style={{ animationDelay: `${i * 140}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </section>

      {/* Composer */}
      <footer className="z-20 shrink-0 pb-[max(10px,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-full max-w-[430px] px-3">
          {(replyTo || editing) && (
            <div className="glass mb-2 flex items-center gap-2 rounded-[20px] px-3 py-2">
              {editing ? (
                <Pencil size={14} strokeWidth={1.9} className="shrink-0 text-ink-2" />
              ) : (
                <Reply size={14} strokeWidth={1.9} className="shrink-0 text-ink-2" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-ink-2">
                  {editing ? "Editing message" : `Replying to ${peer.name}`}
                </span>
                <span className="block truncate text-[12.5px] text-ink">
                  {editing?.text ?? replyTo?.text}
                </span>
              </span>
              <button
                aria-label="Cancel"
                onClick={() => {
                  setReplyTo(null);
                  setEditing(null);
                  setDraft("");
                }}
                className="text-ink-2"
              >
                <X size={16} strokeWidth={1.9} />
              </button>
            </div>
          )}

          {blocked ? (
            <div className="glass mb-2 rounded-[24px] px-4 py-3 text-center">
              <p className="text-[12.5px] text-ink-2">
                You blocked {peer.name}. Unblock to send messages.
              </p>
              <button
                onClick={() => setBlocked(false)}
                className="mt-2 h-9 rounded-full border border-line bg-surface px-4 text-[12.5px] font-semibold text-ink"
              >
                Unblock
              </button>
            </div>
          ) : (
            <div className="mb-2 flex items-center gap-2">
              <button
                aria-label="Add attachment"
                onClick={() => setAttach(true)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft active:scale-[0.97]"
              >
                <Plus size={20} strokeWidth={1.9} />
              </button>

              <div className="relative min-w-0 flex-1">
                <textarea
                  ref={composerRef}
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onFocus={() =>
                    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end" }))
                  }
                  placeholder="Message"
                  className="no-scrollbar block h-11 max-h-28 min-h-11 w-full resize-none overflow-y-auto rounded-[23px] border border-line bg-surface py-[12px] pl-4 pr-9 text-[14px] leading-5 text-ink shadow-soft outline-none placeholder:text-placeholder focus-blue"
                  style={{
                    fontFamily: chatFontStack(
                      resolvedChatFont(settings.chatFont, limits.chatCustomization),
                    ),
                  }}
                />
                <button
                  aria-label="Emoji"
                  onClick={() => setDraft((d) => `${d}🙂`)}
                  className="absolute bottom-[11px] right-3 text-ink-2"
                >
                  <Smile size={18} strokeWidth={1.8} />
                </button>
              </div>

              <button
                aria-label="Send"
                disabled={draft.trim().length === 0}
                onMouseDown={(e) => e.preventDefault()}
                onClick={send}
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-soft transition-colors active:scale-[0.97] ${
                  draft.trim().length > 0
                    ? "bg-ink text-background"
                    : "border border-line bg-muted text-ink-3"
                }`}
              >
                <Send size={18} strokeWidth={1.9} />
              </button>
            </div>
          )}
        </div>
      </footer>

      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center">
          <span className="glass rounded-full px-4 py-2 text-[12px] font-medium text-ink">
            {toast}
          </span>
        </div>
      )}

      {/* Image preview before sending */}
      {pending && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px]">
          <div className="mx-auto flex h-full w-full max-w-[430px] flex-col px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
            <button
              aria-label="Cancel"
              onClick={() => setPending(null)}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-ink"
            >
              <X size={18} strokeWidth={1.9} />
            </button>
            <div className="flex flex-1 items-center">
              <div
                className={`grid w-full gap-2 ${pending.previews.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
              >
                {pending.previews.map((g, i) => (
                  <span
                    key={i}
                    className="block h-[150px] w-full rounded-[18px]"
                    style={{
                      backgroundImage: g,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => pickPhotos(true)}
                aria-label="Add another photo"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/90 text-ink"
              >
                <Plus size={20} strokeWidth={1.9} />
              </button>
              <input
                value={pending.caption}
                onChange={(e) => setPending((p) => (p ? { ...p, caption: e.target.value } : p))}
                placeholder="Add a caption"
                className="h-11 flex-1 rounded-[23px] border border-white/60 bg-white/92 px-4 text-[14px] text-ink outline-none placeholder:text-placeholder"
              />
              <button
                aria-label="Send photos"
                disabled={sending}
                onClick={() => void sendImages()}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-background"
              >
                <Send size={18} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shared media */}
      {mediaOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="mx-auto w-full max-w-[430px] px-4 pt-[max(14px,env(safe-area-inset-top))]">
            <header className="flex items-center gap-2.5">
              <button
                aria-label="Back"
                onClick={() => setMediaOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
              >
                <ChevronLeft size={19} strokeWidth={1.9} />
              </button>
              <div>
                <h2 className="text-[16px] font-semibold text-ink">Shared media</h2>
                <p className="text-[11px] text-ink-2">
                  {media.length} photos with {peer.name}
                </p>
              </div>
            </header>
            {media.length === 0 ? (
              <p className="mt-20 text-center text-[13px] text-ink-2">
                No photos shared in this chat yet.
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-3 gap-1.5">
                {media.map((g, i) => (
                  <span
                    key={i}
                    className="block aspect-square w-full rounded-[12px] bg-muted"
                    style={{
                      backgroundImage: bg(g),
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chat settings */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 bg-background">
          <div className="mx-auto w-full max-w-[430px] px-4 pt-[max(14px,env(safe-area-inset-top))]">
            <header className="flex items-center gap-2.5">
              <button
                aria-label="Back"
                onClick={() => setSettingsOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
              >
                <ChevronLeft size={19} strokeWidth={1.9} />
              </button>
              <div>
                <h2 className="text-[16px] font-semibold text-ink">Chat settings</h2>
                <p className="text-[11px] text-ink-2">{peer.name}</p>
              </div>
            </header>
            <ul className="mt-5 border-y border-line/70">
              {[
                {
                  title: muted ? "Unmute notifications" : "Mute notifications",
                  Icon: BellOff,
                  onSelect: () => setMuted(!muted),
                },
                {
                  title: `Disappearing messages · ${timer}`,
                  Icon: Timer,
                  onSelect: () => setDisappearSheet(true),
                },
                { title: "Shared media", Icon: ImageIcon, onSelect: () => setMediaOpen(true) },
                {
                  title: "Search in chat",
                  Icon: Search,
                  onSelect: () => {
                    setSettingsOpen(false);
                    setSearchOpen(true);
                  },
                },
                {
                  title: "View profile",
                  Icon: UserRound,
                  onSelect: () =>
                    navigate({
                      to: "/profile/$username",
                      params: { username: handleKey(peer.username) },
                    }),
                },
              ].map((r) => (
                <li key={r.title} className="border-b border-line/60 last:border-b-0">
                  <button
                    onClick={r.onSelect}
                    className="flex w-full items-center gap-3 px-1 py-3.5 text-left active:bg-muted/70"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-ink">
                      <r.Icon size={17} strokeWidth={1.8} />
                    </span>
                    <span className="flex-1 text-[14px] font-medium text-ink">{r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            <ul className="mt-6 border-y border-line/70">
              {[
                {
                  title: blocked ? "Unblock" : "Block",
                  Icon: UserX,
                  onSelect: () => setBlockSheet(true),
                },
                { title: "Report", Icon: Flag, onSelect: () => setReportSheet(true) },
                { title: "Delete chat", Icon: Trash2, onSelect: () => setDeleteChatSheet(true) },
              ].map((r) => (
                <li key={r.title} className="border-b border-line/60 last:border-b-0">
                  <button
                    onClick={r.onSelect}
                    className="flex w-full items-center gap-3 px-1 py-3.5 text-left text-red-500 active:bg-muted/70"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-muted text-red-500">
                      <r.Icon size={17} strokeWidth={1.8} />
                    </span>
                    <span className="flex-1 text-[14px] font-medium">{r.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Message actions */}
      <GlassSheet open={Boolean(sheetFor)} onClose={() => setSheetFor(null)}>
        {sheetFor && (
          <div className="mb-1 flex justify-between px-2 pb-1">
            {reactions.map((r) => (
              <button
                key={r}
                onClick={() => {
                  setMsgs((l) =>
                    l.map((m) =>
                      m.id === sheetFor.id
                        ? { ...m, reaction: m.reaction === r ? undefined : r }
                        : m,
                    ),
                  );
                  setSheetFor(null);
                }}
                className="grid h-10 w-10 place-items-center rounded-full text-[19px] active:scale-90"
              >
                {r}
              </button>
            ))}
          </div>
        )}
        {sheetFor && (
          <>
            {[
              { label: "Reply", Icon: CornerUpLeft, onSelect: () => setReplyTo(sheetFor) },
              ...(sheetFor.mine && sheetFor.text
                ? [
                    {
                      label: "Edit",
                      Icon: Pencil,
                      onSelect: () => {
                        setEditing(sheetFor);
                        setDraft(sheetFor.text ?? "");
                      },
                    },
                  ]
                : []),
              {
                label: "Copy",
                Icon: Copy,
                onSelect: async () => {
                  const ok = await copyText(sheetFor.text ?? "");
                  setToast(ok ? "Copied" : "Nothing to copy");
                },
              },
              { label: "Forward", Icon: Forward, onSelect: () => setForwarding(true) },
              { label: "Select messages", Icon: Check, onSelect: () => setSelected([sheetFor.id]) },
              {
                label: "Delete",
                Icon: Trash2,
                tone: "danger" as const,
                onSelect: () => {
                  if (sheetFor.mine && sheetFor.images?.length) {
                    void removeChatImages(sheetFor.images);
                  }
                  setMsgs((l) =>
                    l.map((m) =>
                      m.id === sheetFor.id
                        ? { ...m, deleted: true, text: undefined, images: undefined }
                        : m,
                    ),
                  );
                },
              },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => {
                  a.onSelect?.();
                  setSheetFor(null);
                }}
                className={`flex w-full items-center gap-3 rounded-[20px] px-3.5 py-3 text-left text-[14px] font-medium active:bg-white/60 ${
                  "tone" in a && a.tone === "danger" ? "text-red-500" : "text-ink"
                }`}
              >
                <a.Icon size={18} strokeWidth={1.8} />
                {a.label}
              </button>
            ))}
          </>
        )}
      </GlassSheet>

      {/* Header menu */}
      <GlassSheet
        open={menu}
        title={peer.name}
        onClose={() => setMenu(false)}
        actions={[
          { label: "Search in chat", Icon: Search, onSelect: () => setSearchOpen(true) },
          { label: "Shared media", Icon: ImageIcon, onSelect: () => setMediaOpen(true) },
          {
            label: `Disappearing messages · ${timer}`,
            Icon: Timer,
            onSelect: () => setDisappearSheet(true),
          },
          {
            label: muted ? "Unmute notifications" : "Mute notifications",
            Icon: BellOff,
            onSelect: () => setMuted(!muted),
          },
          { label: "Chat settings", Icon: Settings2, onSelect: () => setSettingsOpen(true) },
          {
            label: trust.mine ? "Trusted — tap to untrust" : "Trust this User",
            Icon: ShieldCheck,
            onSelect: () => {
              if (trust.mine) {
                untrustUser(username);
                setToast("Trust removed");
              } else {
                trustUser(username);
                setToast(
                  trust.theirs
                    ? "Photos and calls unlocked"
                    : "Trusted — waiting for them to trust you too",
                );
              }
            },
          },
          {
            label: blocked ? "Unblock" : "Block",
            Icon: UserX,
            tone: "danger",
            onSelect: () => setBlockSheet(true),
          },
          { label: "Report", Icon: Flag, tone: "danger", onSelect: () => setReportSheet(true) },
          {
            label: "Delete chat",
            Icon: Trash2,
            tone: "danger",
            onSelect: () => setDeleteChatSheet(true),
          },
        ]}
      />

      {/* Attach sheet (no camera) */}
      <GlassSheet
        open={attach}
        title="Send"
        onClose={() => setAttach(false)}
        actions={[
          {
            label: "Photo",
            Icon: ImageIcon,
            onSelect: () => pickPhotos(false),
          },
          {
            label: "Multiple photos",
            Icon: ImageIcon,
            onSelect: () => pickPhotos(true),
          },

          {
            label: "Disappearing photo",
            Icon: Timer,
            onSelect: () => pickPhotos(false, true),
          },
        ]}
      />

      <GlassSheet
        open={disappearSheet}
        title="Disappearing messages"
        onClose={() => setDisappearSheet(false)}
        actions={[
          ...limits.disappearing,
          ...(limits.disappearing.includes("60 days") ? [] : ["60 days"]),
        ].map((t) => ({
          label: timer === t ? `${t} ✓` : t,
          Icon: Timer,
          onSelect: () => {
            if (!limits.disappearing.includes(t) && !requireLimit("disappearing60d")) return;
            setTimer(t);
            if (chat) patchChat(chat.id, { disappearing: t !== "Off" });
            setToast(t === "Off" ? "Disappearing messages off" : `New messages vanish after ${t}`);
          },
        }))}
      />

      <GlassSheet
        open={forwarding}
        title="Forward to"
        onClose={() => setForwarding(false)}
        actions={[
          {
            label: "Copy to clipboard",
            Icon: Copy,
            onSelect: async () => {
              const text = msgs
                .filter((m) => selected.includes(m.id) && m.text)
                .map((m) => m.text as string)
                .join("\n");
              const ok = await copyText(text);
              setToast(ok ? "Copied" : "Nothing to copy");
              if (ok) setSelected([]);
            },
          },
          {
            label: "Forward to another chat",
            Icon: Forward,
            onSelect: () => {
              setSelected([]);
              navigate({ to: "/chat", search: {} });
            },
          },
        ]}
      />

      <GlassSheet
        open={blockSheet}
        title={blocked ? `Unblock ${peer.name}?` : `Block ${peer.name}?`}
        onClose={() => setBlockSheet(false)}
        actions={[
          {
            label: blocked ? "Unblock" : "Block",
            Icon: UserX,
            tone: "danger",
            onSelect: () => {
              setBlocked(!blocked);
              setSettingsOpen(false);
              setToast(blocked ? `${peer.name} unblocked` : `${peer.name} blocked`);
            },
          },
          { label: "Cancel" },
        ]}
      />

      <GlassSheet
        open={reportSheet}
        title={`Report ${peer.name}`}
        onClose={() => setReportSheet(false)}
        actions={["Spam", "Harassment", "Fake account", "Something else"].map((r) => ({
          label: r,
          Icon: Flag,
          tone: "danger" as const,
          onSelect: () => {
            reportUser(username, r);
            setReportSheet(false);
            setToast(`Reported for ${r.toLowerCase()}`);
          },
        }))}
      />

      <GlassSheet
        open={deleteChatSheet}
        title="Delete this chat?"
        onClose={() => setDeleteChatSheet(false)}
        actions={[
          {
            label: "Delete for me",
            Icon: Trash2,
            tone: "danger",
            onSelect: () => {
              if (chat) removeChat(chat.id);
              navigate({ to: "/chat", search: {} });
            },
          },
          { label: "Cancel" },
        ]}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onPickedFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </main>
  );
}
