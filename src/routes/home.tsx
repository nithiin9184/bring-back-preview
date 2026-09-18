import { useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bell, CircleDashed, MessageSquarePlus, Search, Settings, UserRound } from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";
import { GreetingCard } from "@/components/GreetingCard";
import { PeopleStrip } from "@/components/PeopleStrip";
import { SignaturePill } from "@/components/SignaturePill";
import { useSignatureEvent } from "@/lib/events/signature-events";
import { AdSlot } from "@/components/AdSlot";
import { useNotifications } from "@/lib/notifications/use-notifications";
import { useApp, key as handleKey } from "@/lib/store";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Home — N Connect" },
      {
        name: "description",
        content: "Your people, recent chats and suggested connections on N Connect.",
      },
      { property: "og:title", content: "Home — N Connect" },
      {
        property: "og:description",
        content: "Your people, recent chats and suggested connections.",
      },
    ],
  }),
  component: HomeScreen,
});

function greetingFor(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

function HomeScreen() {
  const navigate = useNavigate();
  const signatureEvent = useSignatureEvent();
  const { me, chats, people, relationOf, isPremium, statuses, seenStatus } = useApp();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const { unreadCount: unread } = useNotifications();
  const hasUnseenStatus = statuses.some((status) => !seenStatus.includes(status.id));

  const suggestions = useMemo(() => {
    const list = people.filter((p) => relationOf(p.username) !== "following");
    return list.map((p) => ({ ...p, state: relationOf(p.username) }));
  }, [people, relationOf]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.username.toLowerCase().includes(q) ||
        p.location.toLowerCase().includes(q),
    );
  }, [people, query]);

  const recent = chats.filter((c) => !c.archived).slice(0, 5);

  const quick = [
    {
      label: "Search People",
      Icon: Search,
      onSelect: () => searchRef.current?.focus(),
    },
    {
      label: "New Chat",
      Icon: MessageSquarePlus,
      onSelect: () => navigate({ to: "/chat", search: { new: true } }),
    },
    {
      label: "Status",
      Icon: CircleDashed,
      onSelect: () => navigate({ to: "/status" }),
      statusActive: hasUnseenStatus,
    },
  ];

  return (
    <main className="min-h-screen pb-28 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center gap-2">
          <Link
            to="/profile"
            aria-label="Profile"
            className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            {me.photo ? (
              <Avatar name={me.name} photo={me.photo} size={38} />
            ) : (
              <UserRound size={18} strokeWidth={1.8} />
            )}
          </Link>
          <SignaturePill event={signatureEvent} />
          <div className="flex items-center gap-2">
            <Link
              to="/notifications"
              aria-label="Notifications"
              className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
            >
              <Bell size={18} strokeWidth={1.8} />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-[17px] min-w-[17px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-danger-foreground ring-2 ring-surface">
                  {unread}
                </span>
              )}
            </Link>
            <Link
              to="/settings"
              aria-label="Settings"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
            >
              <Settings size={18} strokeWidth={1.8} />
            </Link>
          </div>
        </header>

        <GreetingCard greeting={greetingFor(me.name)} />

        <div className="relative mt-4">
          <Search
            size={17}
            strokeWidth={1.8}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            className="h-11 w-full rounded-[23px] border border-line bg-surface pl-11 pr-4 text-[14px] text-ink shadow-soft outline-none placeholder:text-placeholder focus:border-brand"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {quick.map(({ label, Icon, onSelect, statusActive }) => (
            <button
              key={label}
              onClick={onSelect}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-medium text-ink shadow-soft active:scale-[0.98]"
            >
              <span
                className={
                  statusActive
                    ? "grid h-6 w-6 place-items-center rounded-full border-2 border-brand"
                    : undefined
                }
              >
                <Icon size={15} strokeWidth={1.8} />
              </span>
              {label}
            </button>
          ))}
        </div>

        {query.trim() ? (
          <section className="mt-7">
            <h2 className="mb-1 text-[16px] font-semibold text-ink">Search results</h2>
            {results.length === 0 ? (
              <p className="mt-2 text-[12px] text-ink-2">Nobody matches “{query.trim()}”.</p>
            ) : (
              <ul className="mt-1">
                {results.map((p, i) => (
                  <li key={p.id}>
                    <Link
                      to="/profile/$username"
                      params={{ username: handleKey(p.username) }}
                      className="flex w-full items-center gap-3 py-3 text-left"
                    >
                      <Avatar name={p.name} seed={Number(p.id)} size={46} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-ink">
                          {p.name}
                        </span>
                        <span className="block truncate text-[12px] text-ink-2">{p.username}</span>
                        <span className="block truncate text-[11px] text-ink-3">{p.location}</span>
                      </span>
                      <span className="shrink-0 text-[11px] font-medium text-ink-3 capitalize">
                        {relationOf(p.username)}
                      </span>
                    </Link>
                    {i < results.length - 1 && <span className="ml-[58px] block h-px bg-line/70" />}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <section className="mt-7">
            <h2 className="mb-3 text-[16px] font-semibold text-ink">People You May Know</h2>
            {suggestions.length === 0 && (
              <p className="text-[12px] text-ink-2">No suggestions yet.</p>
            )}
          </section>
        )}
      </Screen>

      {!query.trim() && <PeopleStrip people={suggestions} />}

      <Screen>
        {!isPremium && <AdSlot index={0} />}

        <section className="mt-8">
          <h2 className="text-[16px] font-semibold text-ink">Recent Chats</h2>
          {recent.length === 0 ? (
            <p className="mt-2 text-[12px] text-ink-2">No conversations yet.</p>
          ) : (
            <ul className="mt-1">
              {recent.map((c, i) => (
                <li key={c.id}>
                  <Link
                    to="/chat/$username"
                    params={{ username: handleKey(c.username) }}
                    className="flex w-full items-center gap-3 py-3 text-left"
                  >
                    <span className="relative shrink-0">
                      <Avatar name={c.name} seed={i} size={48} />
                      {c.online && (
                        <span className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-surface" />
                      )}
                      {c.unread ? (
                        <span
                          aria-label={`${c.unread} new messages`}
                          className={`absolute -right-0.5 -top-0.5 grid h-[17px] place-items-center rounded-full bg-danger text-[10px] font-semibold text-danger-foreground ring-2 ring-surface ${
                            c.unread > 1 ? "min-w-[17px] px-1" : "w-[17px]"
                          }`}
                        >
                          {c.unread > 1 ? c.unread : ""}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[14px] font-semibold text-ink">
                          {c.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-3">{c.time}</span>
                      </span>
                      <span className="mt-0.5 flex items-center justify-between gap-2">
                        <span className="truncate text-[12px] text-ink-2">{c.message}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">
                          {c.online ? "Active now" : (c.lastSeen ?? "")}
                        </span>
                      </span>
                    </span>
                  </Link>
                  {i < recent.length - 1 && <span className="ml-[60px] block h-px bg-line/70" />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Screen>

      <BottomNav />
    </main>
  );
}
