/**
 * Live event feed for the Signature Pill.
 *
 * One subscription per signed-in user (filtered server-side to rows addressed
 * to that user) for messages and notifications, plus the call state from the
 * call provider. Handled events clear themselves: opening or dismissing a
 * message marks it read, a notification is marked read, a call event goes
 * away as soon as the call is answered, declined or ended.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Phone, Video, type LucideIcon } from "lucide-react";
import type {
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import {
  notificationsKey,
  upsertCachedNotification,
  type NotificationItem,
} from "@/lib/notifications/use-notifications";
import { getBackend } from "@/lib/calls/backend";
import { useCall } from "@/lib/calls/call-provider";
import { useApp, key as handleKey } from "@/lib/store";
import type { ChatMessage, NotificationType } from "@/data/types";
import {
  fetchUndeliveredMessages,
  fetchUnreadNotifications,
  markConversationRead,
  markMessagesDelivered,
  markNotificationRead,
  resolvePeerById,
  type MessageRow,
  type NotificationRow,
} from "./realtime-events";

export type SignatureEvent = {
  label: string;
  Icon?: LucideIcon;
  name?: string;
  message?: string;
  avatarSeed?: number;
  onOpen?: () => void;
  onDismiss?: () => void;
};

type Pending =
  | {
      kind: "message";
      id: string;
      senderId: string;
      name: string;
      username: string;
      preview: string;
    }
  | {
      kind: "notification";
      id: string;
      name: string;
      username: string | null;
      text: string;
      type: NotificationType;
    };

type Ctx = { event: SignatureEvent | null; userId: string | null };

const EventsContext = createContext<Ctx | null>(null);

/** The event the Signature Pill should show right now (null when nothing is pending). */
export function useSignatureEvent(): SignatureEvent | null {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error("useSignatureEvent must be used inside <SignatureEventsProvider>");
  return ctx.event;
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function previewOf(row: MessageRow): string {
  const images = Array.isArray(row.images) ? row.images.length : 0;
  return images ? `Sent ${images} ${images === 1 ? "photo" : "photos"}` : (row.body ?? "");
}

function toChatMessage(row: MessageRow): ChatMessage {
  const images = Array.isArray(row.images) ? (row.images as string[]) : [];
  return {
    id: row.id,
    mine: false,
    time: clock(row.created_at),
    state: "read",
    ...(row.body ? { text: row.body } : {}),
    ...(images.length ? { images } : {}),
    ...(row.reply_to ? { replyTo: row.reply_to } : {}),
  } as ChatMessage;
}

export function SignatureEventsProvider({ children }: { children: ReactNode }) {
  const { receiveMessage } = useApp();
  const queryClient = useQueryClient();
  const { call, peer: callPeer } = useCall();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [userId, setUserId] = useState<string | null>(null);
  const [queue, setQueue] = useState<Pending[]>([]);
  // Ids already processed on this device: realtime and the catch-up read can
  // both hand us the same row.
  const seen = useRef(new Set<string>());
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const enqueue = useCallback((item: Pending) => {
    setQueue((q) => (q.some((x) => x.kind === item.kind && x.id === item.id) ? q : [...q, item]));
  }, []);
  const drop = useCallback((kind: Pending["kind"], id: string) => {
    setQueue((q) => q.filter((x) => !(x.kind === kind && x.id === id)));
  }, []);

  const ingestMessage = useCallback(
    async (row: MessageRow) => {
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);
      const from = await resolvePeerById(row.sender_id);
      if (!from) return;
      receiveMessage({ name: from.name, username: from.username }, toChatMessage(row));
      void markMessagesDelivered([row.id]);
      // Inside that person's chat the message shows in the thread — no pill.
      if (pathRef.current === `/chat/${handleKey(from.username)}`) {
        if (userId) void markConversationRead(userId, row.sender_id);
        return;
      }
      enqueue({
        kind: "message",
        id: row.id,
        senderId: row.sender_id,
        name: from.name,
        username: from.username,
        preview: previewOf(row),
      });
    },
    [enqueue, receiveMessage, userId],
  );

  const ingestNotification = useCallback(
    (row: NotificationRow) => {
      if (seen.current.has(row.id)) return;
      seen.current.add(row.id);
      // The server list (Notifications screen, Home badge) learns about the
      // row here, whether it came live or from the sign-in catch-up read.
      if (userId) upsertCachedNotification(queryClient, userId, row);
      if (!row.unread) return;
      enqueue({
        kind: "notification",
        id: row.id,
        name: row.name,
        username: row.username,
        text: row.text,
        type: row.type as NotificationType,
      });
    },
    [enqueue, queryClient, userId],
  );

  // Read-state or request answers made elsewhere (another device, the
  // Notifications screen) clear the pill and refresh the list.
  const applyNotificationUpdate = useCallback(
    (row: NotificationRow) => {
      if (userId) upsertCachedNotification(queryClient, userId, row);
      if (!row.unread) drop("notification", row.id);
    },
    [drop, queryClient, userId],
  );

  // Track the signed-in account.
  useEffect(() => {
    const supabase = getBackend();
    if (!supabase) return;
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setUserId(session?.user.id ?? null);
        if (event === "SIGNED_OUT") {
          seen.current.clear();
          setQueue([]);
        }
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // One realtime channel per user; catch up on anything missed while away.
  useEffect(() => {
    const supabase = getBackend();
    if (!supabase || !userId) return;
    let active = true;

    const channel = supabase
      .channel(`signature:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload: RealtimePostgresInsertPayload<MessageRow>) => {
          if (active) void ingestMessage(payload.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresInsertPayload<NotificationRow>) => {
          if (active) ingestNotification(payload.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresUpdatePayload<NotificationRow>) => {
          if (active) applyNotificationUpdate(payload.new);
        },
      )
      .subscribe();

    void (async () => {
      const [messages, notifications] = await Promise.all([
        fetchUndeliveredMessages(userId),
        fetchUnreadNotifications(userId),
      ]);
      if (!active) return;
      for (const row of messages) await ingestMessage(row);
      for (const row of notifications.reverse()) ingestNotification(row);
    })();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, ingestMessage, ingestNotification, applyNotificationUpdate]);

  // Build the pill event: a live call always wins, then the oldest pending item.
  const event = useMemo<SignatureEvent | null>(() => {
    const live = call && !["idle", "ended", "failed", "unavailable"].includes(call.status);
    if (call && callPeer && live) {
      const Icon = call.callType === "video" ? Video : Phone;
      const label =
        call.incoming && call.status !== "connected"
          ? `Incoming ${call.callType} call`
          : call.status === "connected"
            ? `${call.callType === "video" ? "Video" : "Voice"} call in progress`
            : call.status === "reconnecting"
              ? "Reconnecting…"
              : "Calling…";
      return { label, Icon, name: callPeer.name, message: label };
    }
    const next = queue[0];
    if (!next) return null;
    if (next.kind === "message") {
      const finish = () => {
        drop("message", next.id);
        if (userId) void markConversationRead(userId, next.senderId);
      };
      return {
        label: "New message",
        name: next.name,
        message: next.preview,
        onDismiss: finish,
        onOpen: () => {
          finish();
          navigate({ to: "/chat/$username", params: { username: handleKey(next.username) } });
        },
      };
    }
    const finish = () => {
      drop("notification", next.id);
      if (userId) {
        queryClient.setQueryData<NotificationItem[]>(notificationsKey(userId), (current) =>
          (current ?? []).map((n) => (n.id === next.id ? { ...n, unread: false } : n)),
        );
      }
      void markNotificationRead(next.id);
    };
    return {
      label: next.text,
      name: next.name,
      message: next.text,
      onDismiss: finish,
      onOpen: () => {
        finish();
        if (
          (next.type === "message" || next.type === "message_request" || next.type === "call") &&
          next.username
        ) {
          navigate({ to: "/chat/$username", params: { username: handleKey(next.username) } });
        } else {
          navigate({ to: "/notifications" });
        }
      },
    };
  }, [call, callPeer, queue, userId, drop, navigate, queryClient]);

  const value = useMemo<Ctx>(() => ({ event, userId }), [event, userId]);
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}
