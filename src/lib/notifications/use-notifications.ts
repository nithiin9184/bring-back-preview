/**
 * Server-backed notification state shared by the Notifications screen, the
 * Home badge and the Signature Pill.
 *
 * The server is the source of truth: the list is loaded on sign-in, kept
 * current by the live feed (see signature-events.tsx, which writes new rows and
 * read-state changes into this cache) and every read/unread change is written
 * back before the UI relies on it.
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBackend } from "@/lib/calls/backend";
import type { AppNotification, NotificationType } from "@/data/types";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from "@/lib/events/realtime-events";
import { resolveRequestNotification } from "./notifications.functions";

export const notificationsKey = (userId: string | null) => ["notifications", userId] as const;

export type NotificationItem = AppNotification & { createdAt: string };

function relativeTime(iso: string): string {
  const delta = Math.max(0, Date.now() - new Date(iso).getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type as NotificationType,
    name: row.name,
    text: row.text,
    unread: row.unread,
    time: relativeTime(row.created_at),
    createdAt: row.created_at,
    ...(row.username ? { username: row.username } : {}),
    ...(row.tone !== "default" ? { tone: row.tone as "warning" | "success" } : {}),
  };
}

/** Recent history (read and unread), newest first. */
export async function fetchNotificationHistory(userId: string): Promise<NotificationItem[]> {
  const supabase = getBackend();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Notifications could not be loaded");
  return ((data ?? []) as NotificationRow[]).map(toNotificationItem);
}

/** Inserts or replaces one row in the cached list (used by the live feed). */
export function upsertCachedNotification(
  queryClient: QueryClient,
  userId: string,
  row: NotificationRow,
): void {
  const item = toNotificationItem(row);
  queryClient.setQueryData<NotificationItem[]>(notificationsKey(userId), (current) => {
    const list = current ?? [];
    const index = list.findIndex((n) => n.id === item.id);
    if (index === -1) {
      return [item, ...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    const next = list.slice();
    next[index] = item;
    return next;
  });
}

function patchCached(
  queryClient: QueryClient,
  userId: string,
  patch: (n: NotificationItem) => NotificationItem,
) {
  queryClient.setQueryData<NotificationItem[]>(notificationsKey(userId), (current) =>
    (current ?? []).map(patch),
  );
}

/** The signed-in account id, kept current across sign-in/out. */
export function useSignedInUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
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
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return userId;
}

export function useNotifications() {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  const resolveRequest = useServerFn(resolveRequestNotification);

  const query = useQuery({
    queryKey: notificationsKey(userId),
    queryFn: () => fetchNotificationHistory(userId as string),
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  const items = query.data ?? [];
  const unreadCount = items.filter((n) => n.unread).length;

  const markRead = useCallback(
    async (id: string) => {
      if (!userId) return;
      patchCached(queryClient, userId, (n) => (n.id === id ? { ...n, unread: false } : n));
      await markNotificationRead(id);
    },
    [queryClient, userId],
  );

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    patchCached(queryClient, userId, (n) => ({ ...n, unread: false }));
    await markAllNotificationsRead(userId);
  }, [queryClient, userId]);

  const resolve = useMutation({
    mutationFn: (input: { id: string; accept: boolean }) => resolveRequest({ data: input }),
    onSuccess: (result, input) => {
      if (!userId || !result.ok) return;
      const accepted = input.accept && result.outcome === "answered";
      patchCached(queryClient, userId, (n) =>
        n.id === input.id
          ? {
              ...n,
              unread: false,
              type: accepted ? "accepted" : n.type,
              text:
                result.outcome === "expired"
                  ? "This request is no longer open"
                  : input.accept
                    ? "You accepted the request"
                    : "Request rejected",
              ...(accepted ? { tone: "success" as const } : {}),
            }
          : n,
      );
      void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    },
  });

  return {
    userId,
    items,
    unreadCount,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
    markRead,
    markAllRead,
    resolve,
  };
}
