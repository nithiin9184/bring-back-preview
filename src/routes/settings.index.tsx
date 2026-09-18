import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  BadgeCheck,
  Bell,
  ChevronRight,
  Crown,
  Database,
  FileText,
  HardDrive,
  Info,
  LifeBuoy,
  Lock,
  LogOut,
  MessageCircle,
  Palette,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  UserX,
} from "lucide-react";
import { useState } from "react";
import { Avatar, Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";
import { GlassSheet } from "@/components/GlassSheet";
import { ActionRow, Group } from "@/components/settings-kit";
import { useApp } from "@/lib/store";
import { LEGAL_DOCS, type LegalDocId } from "@/lib/legal/documents";
import { supabase } from "@/integrations/supabase/client";

const legalIcons: Record<LegalDocId, typeof Info> = {
  terms: ScrollText,
  privacy: FileText,
  safety: ShieldCheck,
};

export const Route = createFileRoute("/settings/")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Settings — N Connect" },
      { name: "description", content: "Manage your N Connect account, privacy and preferences." },
      { property: "og:title", content: "Settings — N Connect" },
      { property: "og:description", content: "Manage account, privacy and preferences." },
    ],
  }),
  component: SettingsScreen,
});

const groups = [
  {
    label: "Account",
    rows: [
      {
        key: "account",
        title: "Account",
        note: "Name, username, phone and email",
        Icon: UserRound,
      },
      {
        key: "privacy",
        title: "Privacy",
        note: "Who can find, follow and message you",
        Icon: Lock,
      },
      {
        key: "security",
        title: "Security & Sessions",
        note: "Devices, password and login alerts",
        Icon: ShieldCheck,
      },
      { key: "blocked", title: "Blocked Users", note: "People you blocked", Icon: UserX },
    ],
  },
  {
    label: "Preferences",
    rows: [
      {
        key: "notifications",
        title: "Notifications",
        note: "Messages, calls and requests",
        Icon: Bell,
      },
      {
        key: "chat",
        title: "Chat",
        note: "Disappearing, read receipts, media",
        Icon: MessageCircle,
      },
      { key: "appearance", title: "Appearance", note: "Chat background, text size", Icon: Palette },
      {
        key: "storage",
        title: "Storage & Data",
        note: "Cache, downloads, call quality",
        Icon: HardDrive,
      },
    ],
  },
  {
    label: "Data",
    rows: [
      {
        key: "backup",
        title: "Backup & Restore",
        note: "Encrypted backup and restore with Google Drive",
        Icon: Database,
      },
      {
        key: "account-data",
        title: "Account & Data",
        note: "Export or transfer your data",
        Icon: BadgeCheck,
      },
    ],
  },
  {
    label: "More",
    rows: [
      { key: "premium", title: "N Connect Premium", note: "Unlock everything", Icon: Crown },
      {
        key: "support",
        title: "Support",
        note: "Help centre and report a problem",
        Icon: LifeBuoy,
      },
      { key: "about", title: "About", note: "Version, terms and privacy policy", Icon: Info },
    ],
  },
] as const;

function SettingsScreen() {
  const navigate = useNavigate();
  const { me, isPremium, signOut } = useApp();
  const [query, setQuery] = useState("");
  const [logout, setLogout] = useState(false);

  const go = (section: string) => navigate({ to: "/settings/$section", params: { section } });
  const q = query.trim().toLowerCase();

  return (
    <main className="min-h-screen pb-28 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Settings</h1>
        </header>

        <Link
          to="/profile"
          className="mt-4 flex items-center gap-3 py-3 active:opacity-70"
        >
          <Avatar name={me.name} seed={3} size={50} photo={me.photo} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">
              {me.name || "Your profile"}
            </span>
            <span className="block truncate text-[12px] text-ink-2">
              {me.username ? (me.username.startsWith("@") ? me.username : `@${me.username}`) : "Username not set"}
            </span>
            {me.location && (
              <span className="block truncate text-[11px] text-ink-3">{me.location}</span>
            )}
          </span>
          <ChevronRight size={18} strokeWidth={1.8} className="shrink-0 text-ink-3" />
        </Link>

        <div className="relative mt-4">
          <Search
            size={17}
            strokeWidth={1.8}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            className="h-11 w-full rounded-[23px] border border-line bg-surface pl-11 pr-4 text-[14px] text-ink shadow-soft outline-none placeholder:text-placeholder focus-blue"
          />
        </div>

        {groups.map((g) => {
          const rows = g.rows.filter(
            (r) => !q || r.title.toLowerCase().includes(q) || r.note.toLowerCase().includes(q),
          );
          if (rows.length === 0) return null;
          return (
            <Group key={g.label} label={g.label}>
              {rows.map((r) => (
                <ActionRow
                  key={r.key}
                  Icon={r.Icon}
                  title={r.title}
                  note={r.key === "premium" && isPremium ? "Premium active" : r.note}
                  onSelect={() => go(r.key)}
                />
              ))}
            </Group>
          );
        })}

        {(() => {
          const rows = LEGAL_DOCS.filter(
            (d) => !q || d.title.toLowerCase().includes(q) || d.note.toLowerCase().includes(q),
          );
          if (rows.length === 0) return null;
          return (
            <Group label="Legal & Policies">
              {rows.map((d) => (
                <ActionRow
                  key={d.id}
                  Icon={legalIcons[d.id]}
                  title={d.title}
                  note={d.note}
                  onSelect={() =>
                    navigate({ to: "/settings/legal/$document", params: { document: d.id } })
                  }
                />
              ))}
            </Group>
          );
        })()}


        <Group>
          <ActionRow
            Icon={LogOut}
            title="Log out"
            chevron={false}
            onSelect={() => setLogout(true)}
          />
          <ActionRow
            Icon={Trash2}
            title="Delete account"
            note="Permanently remove N Connect"
            danger
            onSelect={() => go("delete-account")}
          />
        </Group>

        <p className="mt-6 text-center text-[11px] text-ink-3">
          N Connect 1.4.0 · Encrypted by default
        </p>
      </Screen>

      <GlassSheet
        open={logout}
        title="Log out of N Connect?"
        onClose={() => setLogout(false)}
        actions={[
          {
            label: "Log out",
            Icon: LogOut,
            tone: "danger",
            onSelect: async () => {
              await supabase.auth.signOut();
              signOut();
              await navigate({ to: "/login" });
            },
          },
          { label: "Stay signed in" },
        ]}
      />

      <BottomNav />
    </main>
  );
}
