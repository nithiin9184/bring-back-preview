import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Heart,
  MessageCircle,
  PhoneMissed,
  ShieldAlert,
  UserRoundPlus,
  X,
} from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";
import { AdSlot } from "@/components/AdSlot";
import { useApp, key as handleKey } from "@/lib/store";
import type { AppNotification } from "@/data/types";
import { useNotifications } from "@/lib/notifications/use-notifications";

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Notifications — N Connect" },
      {
        name: "description",
        content: "Follow requests, profile likes, messages, calls and account alerts on N Connect.",
      },
      { property: "og:title", content: "Notifications — N Connect" },
      {
        property: "og:description",
        content: "Requests, likes, messages, calls and account alerts.",
      },
    ],
  }),
  component: NotificationsScreen,
});

const iconFor = {
  follower: UserRoundPlus,
  request: UserRoundPlus,
  accepted: Check,
  like: Heart,
  message: MessageCircle,
  message_request: MessageCircle,
  call: PhoneMissed,
  security: ShieldAlert,
} as const;

function toneClass(n: AppNotification) {
  if (n.tone === "warning") return "text-red-500";
  if (n.tone === "success") return "text-emerald-600";
  return "text-ink-2";
}

function NotificationRow({
  n,
  onOpen,
  onResolve,
}: {
  n: AppNotification;
  onOpen: () => void;
  onResolve: (accept: boolean) => void;
}) {
  const Icon = iconFor[n.type];
  const isRequest = n.type === "request" || n.type === "message_request";
  const isSystem = n.type === "security";

  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-start gap-3 py-3.5 text-left">
        <span className="relative shrink-0">
          {isSystem ? (
            <span className="grid h-11 w-11 place-items-center rounded-full bg-muted text-ink-2">
              <ShieldAlert size={19} strokeWidth={1.8} />
            </span>
          ) : (
            <Avatar name={n.name} seed={n.name.length} size={44} />
          )}
          {n.unread && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
          )}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-semibold text-ink">{n.name}</span>
            <span className="shrink-0 text-[11px] text-ink-3">{n.time}</span>
          </span>
          <span className={`mt-0.5 flex items-center gap-1.5 text-[12px] ${toneClass(n)}`}>
            <Icon size={13} strokeWidth={1.9} className="shrink-0" />
            <span className="truncate">{n.text}</span>
          </span>
          {n.username && !isSystem && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-3">{n.username}</span>
          )}

          {isRequest && (
            <span className="mt-2.5 flex gap-2">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve(true);
                }}
                className="inline-flex h-8 items-center rounded-full bg-brand px-4 text-[12px] font-semibold text-white active:scale-[0.98]"
              >
                Accept
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve(false);
                }}
                className="inline-flex h-8 items-center rounded-full bg-muted px-4 text-[12px] font-semibold text-ink-2 active:scale-[0.98]"
              >
                Reject
              </span>
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function NotificationsScreen() {
  const navigate = useNavigate();
  const { notify } = useApp();
  const {
    userId,
    items,
    unreadCount,
    isLoading,
    isError,
    refetch,
    markRead,
    markAllRead: markAllReadOnServer,
    resolve: resolveMutation,
  } = useNotifications();

  const markAllRead = () => {
    void markAllReadOnServer().then(
      () => notify("All notifications read"),
      () => notify("Couldn't update notifications"),
    );
  };

  const resolve = (id: string, accept: boolean) => {
    if (resolveMutation.isPending) return;
    resolveMutation.mutate(
      { id, accept },
      {
        onSuccess: (result) => {
          if (!result.ok) return notify("Couldn't update this request");
          if (result.outcome === "expired") return notify("This request is no longer open");
          notify(accept ? "Request accepted" : "Request rejected");
        },
        onError: () => notify("Couldn't update this request"),
      },
    );
  };

  const open = (n: AppNotification) => {
    if (n.unread) void markRead(n.id);
    if (n.type === "message" || n.type === "message_request" || n.type === "call") {
      if (n.username) {
        navigate({ to: "/chat/$username", params: { username: handleKey(n.username) } });
      } else {
        navigate({ to: "/chat" });
      }
      return;
    }
    if (n.type === "security") {
      navigate({ to: "/settings" });
      return;
    }
    if (n.username) {
      navigate({ to: "/profile/$username", params: { username: handleKey(n.username) } });
    }
  };

  return (
    <main className="min-h-screen pb-28 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center gap-2">
          <button
            aria-label="Back"
            onClick={() => navigate({ to: "/home" })}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            <ArrowLeft size={18} strokeWidth={1.8} />
          </button>
          <h1 className="flex-1 text-[17px] font-semibold tracking-[-0.01em] text-ink">
            Notifications
          </h1>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="text-[12px] font-semibold text-brand disabled:text-ink-3"
          >
            Mark all read
          </button>
        </header>

        {!userId ? (
          <div className="mt-24 text-center">
            <p className="text-[13px] font-medium text-ink">Sign in to see your notifications</p>
          </div>
        ) : isLoading ? (
          <ul className="mt-6" aria-busy="true" aria-label="Loading notifications">
            {[0, 1, 2].map((i) => (
              <li key={i} className="flex items-center gap-3 py-3.5">
                <span className="h-11 w-11 animate-pulse rounded-full bg-muted" />
                <span className="flex-1">
                  <span className="block h-3 w-1/2 animate-pulse rounded bg-muted" />
                  <span className="mt-2 block h-3 w-3/4 animate-pulse rounded bg-muted" />
                </span>
              </li>
            ))}
          </ul>
        ) : isError ? (
          <div className="mt-24 text-center">
            <ShieldAlert size={22} strokeWidth={1.6} className="mx-auto text-ink-3" />
            <p className="mt-2 text-[13px] font-medium text-ink">
              Notifications couldn't be loaded
            </p>
            <button
              onClick={() => void refetch()}
              className="mt-4 inline-flex h-9 items-center rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-ink shadow-soft"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-24 text-center">
            <X size={22} strokeWidth={1.6} className="mx-auto text-ink-3" />
            <p className="mt-2 text-[13px] font-medium text-ink">No notifications yet</p>
          </div>
        ) : (
          <ul className="mt-6">
            {items.map((n, i) => (
              <div key={n.id}>
                <NotificationRow
                  n={n}
                  onOpen={() => open(n)}
                  onResolve={(accept) => resolve(n.id, accept)}
                />
                {i < items.length - 1 && <span className="ml-[56px] block h-px bg-line/60" />}
              </div>
            ))}
          </ul>
        )}
        <AdSlot index={5} />
      </Screen>
      <BottomNav />
    </main>
  );
}
