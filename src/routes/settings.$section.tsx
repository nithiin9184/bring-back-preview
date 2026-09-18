import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AtSign,
  BadgeCheck,
  Bell,
  Camera,
  Check,
  CloudUpload,
  Crown,
  Download,
  Eye,
  FileText,
  Flag,
  Gauge,
  Image as ImageIcon,
  KeyRound,
  Laptop,
  LifeBuoy,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Smartphone,
  Star,
  Timer,
  Trash2,
  Type,
  UserRound,
  UserX,
  Video,
  Wifi,
} from "lucide-react";
import { Avatar, Button, Field, Label } from "@/components/ui-kit";
import { GlassSheet } from "@/components/GlassSheet";
import {
  BackupScreen,
  BackupSettingsScreen,
  RestoreScreen,
} from "@/components/backup/BackupScreens";
import {
  ActionRow,
  ChoiceRow,
  Group,
  InfoNote,
  SettingsShell,
  ToggleRow,
} from "@/components/settings-kit";
import chatPetals from "@/assets/chat-petals.jpg";
import { ImageAdjuster } from "@/components/ImageAdjuster";
import { useApp } from "@/lib/store";
import { copyText } from "@/lib/clipboard";
import { downloadAccountData } from "@/lib/account/export-data";
import { deleteCurrentAccount } from "@/lib/account/delete-account.functions";
import { supabase } from "@/integrations/supabase/client";
import { normalizeUsername } from "@/lib/username/username-service";
import { useUsernameAvailability } from "@/lib/username/use-username-availability";
import {
  DAILY_CONNECT_CREDITS,
  EXTRA_CREDIT_MIN,
  EXTRA_CREDIT_PRICE,
  PLAN_LIST,
  type PlanId,
} from "@/lib/entitlements";
import { accountStorageUsage } from "@/lib/storage/local-usage";
import { saveSettings } from "@/lib/account/account-repository";
import {
  removeAppearanceBackground,
  resolveAppearanceBackground,
  uploadAppearanceBackground,
} from "@/lib/appearance/background-repository";
import {
  BUBBLE_COLOURS,
  CHAT_FONTS,
  bubbleStyle,
  chatFontStack,
  isBubbleColourLocked,
  isChatFontLocked,
  resolvedChatFont,
} from "@/lib/appearance/chat-style";

export const Route = createFileRoute("/settings/$section")({
  head: ({ params }) => {
    const title = titles[params.section]?.title ?? "Settings";
    return {
      meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { title: `${title} — N Connect Settings` },
        { name: "description", content: `${title} settings for your N Connect account.` },
        { property: "og:title", content: `${title} — N Connect Settings` },
        { property: "og:description", content: `${title} settings for your N Connect account.` },
      ],
    };
  },
  component: SectionScreen,
});

const titles: Record<string, { title: string; subtitle: string }> = {
  account: { title: "Account", subtitle: "Your identity on N Connect" },
  privacy: { title: "Privacy", subtitle: "Control who reaches you" },
  notifications: { title: "Notifications", subtitle: "What you get alerted about" },
  chat: { title: "Chat", subtitle: "Messages, media and receipts" },
  appearance: { title: "Appearance", subtitle: "Chat background and text" },
  storage: { title: "Storage & Data", subtitle: "Space and network usage" },
  security: { title: "Security & Sessions", subtitle: "Devices and protection" },
  premium: { title: "Premium", subtitle: "N Connect Premium" },
  support: { title: "Support", subtitle: "We're here to help" },
  about: { title: "About", subtitle: "N Connect 1.4.0" },
  "account-data": { title: "Account & Data", subtitle: "Export, transfer, deactivate" },
  "chat-backup": { title: "Backup & Restore", subtitle: "Encrypted backup to your Google Drive" },
  backup: { title: "Backup & Restore", subtitle: "Encrypted backup to your Google Drive" },
  "backup-settings": { title: "Backup Settings", subtitle: "Schedule and what gets backed up" },
  restore: { title: "Restore", subtitle: "Bring a backup back to this device" },
  blocked: { title: "Blocked Users", subtitle: "People who can't reach you" },
  restricted: { title: "Restricted Accounts", subtitle: "People whose alerts are muted" },
  "delete-account": { title: "Delete Account", subtitle: "This cannot be undone" },
};

function SectionScreen() {
  const { section } = Route.useParams();
  const meta = titles[section];

  if (!meta) {
    return (
      <SettingsShell title="Not found">
        <p className="mt-10 text-center text-[13px] text-ink-2">
          This settings page doesn't exist.
        </p>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell title={meta.title} subtitle={meta.subtitle}>
      {section === "account" && <AccountSection />}
      {section === "privacy" && <PrivacySection />}
      {section === "notifications" && <NotificationsSection />}
      {section === "chat" && <ChatSection />}
      {section === "appearance" && <AppearanceSection />}
      {section === "storage" && <StorageSection />}
      {section === "security" && <SecuritySection />}
      {section === "premium" && <PremiumSection />}
      {section === "support" && <SupportSection />}
      {section === "about" && <AboutSection />}
      {section === "account-data" && <AccountDataSection />}
      {(section === "chat-backup" || section === "backup") && <BackupScreen />}
      {section === "backup-settings" && <BackupSettingsScreen />}
      {section === "restore" && <RestoreScreen />}
      {section === "blocked" && <BlockedSection />}
      {section === "restricted" && <RestrictedSection />}
      {section === "delete-account" && <DeleteAccountSection />}
    </SettingsShell>
  );
}

/* ---------------- Account ---------------- */

function AccountSection() {
  const navigate = useNavigate();
  const { me, setMe, setSettings, notify, authPhone, ready } = useApp();
  const [saved, setSaved] = useState(false);
  const saving = useRef(false);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const [raw, setRaw] = useState("");
  const [form, setForm] = useState({
    name: me.name,
    username: normalizeUsername(me.username),
    bio: me.bio,
    location: me.location,
    photo: me.photo ?? "",
    private: me.private ?? false,
  });
  // The store hydrates from local storage after mount, so refill the form once
  // the saved profile is available.
  const filled = useRef(false);
  useEffect(() => {
    if (!ready || filled.current) return;
    filled.current = true;
    setForm({
      name: me.name,
      username: normalizeUsername(me.username),
      bio: me.bio,
      location: me.location,
      photo: me.photo ?? "",
      private: me.private ?? false,
    });
  }, [ready, me]);

  const currentHandle = normalizeUsername(me.username);
  const usernameChanged = form.username !== currentHandle;
  const { status: usernameStatus, error: usernameError } = useUsernameAvailability(
    usernameChanged ? form.username : "",
  );
  const usernameOk = !usernameChanged || usernameStatus === "available";

  // Picking an image opens the adjust/crop step before it becomes the photo.
  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setRaw(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <div className="mt-5 flex flex-col items-start">
        <span className="relative inline-flex">
          <Avatar name={form.name} seed={3} size={68} photo={form.photo} />
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              pickPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            aria-label="Change profile photo"
            onClick={() => photoInput.current?.click()}
            className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            <Camera size={12} strokeWidth={2} />
          </button>
        </span>
        <p className="mt-2.5 text-[16px] font-semibold text-ink">{form.name || "Name not set"}</p>
      </div>

      {raw && (
        <ImageAdjuster
          src={raw}
          onCancel={() => setRaw("")}
          onSave={(photo) => {
            setRaw("");
            setForm((f) => ({ ...f, photo }));
            setMe({ photo });
            notify("Profile photo updated");
          }}
        />
      )}

      <div className="mt-5 space-y-3">
        <div className="w-fit max-w-full">
          <Label>Name</Label>
          <Field
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-[220px] max-w-full"
          />
        </div>
        <div className="w-fit max-w-full">
          <Label>Username</Label>
          <Field
            value={form.username}
            onChange={(e) =>
              setForm((f) => ({ ...f, username: normalizeUsername(e.target.value) }))
            }
            autoCapitalize="none"
            spellCheck={false}
            className="w-[220px] max-w-full"
            aria-invalid={usernameStatus === "invalid" || usernameStatus === "taken"}
          />
          {usernameChanged && usernameStatus !== "idle" && (
            <p
              aria-live="polite"
              className={`mt-1.5 pl-1 text-[12px] ${
                usernameStatus === "available"
                  ? "text-brand"
                  : usernameStatus === "checking"
                    ? "text-ink-3"
                    : "text-red-500"
              }`}
            >
              {usernameStatus === "checking" && "Checking…"}
              {usernameStatus === "available" && "✓ Username available"}
              {usernameStatus === "taken" && "✕ Username already taken"}
              {usernameStatus === "invalid" && usernameError}
              {usernameStatus === "error" && "Couldn't check right now — try again"}
            </p>
          )}
        </div>
        <div className="w-fit max-w-full">
          <Label>Location</Label>
          <Field
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            className="w-[220px] max-w-full"
          />
        </div>
        <div>
          <Label>Bio</Label>
          <textarea
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            rows={4}
            className="min-h-28 w-full resize-none rounded-[18px] border border-line bg-surface px-4 py-3 text-[14px] text-ink shadow-soft outline-none transition-[border-color,box-shadow] focus-blue"
          />
        </div>
      </div>

      <Group label="Visibility">
        <ToggleRow
          Icon={Lock}
          title="Private account"
          note="Only approved followers can see your profile"
          on={form.private}
          onChange={(v) => setForm((f) => ({ ...f, private: v }))}
        />
      </Group>

      <Group label="Linked">
        <ActionRow
          Icon={Phone}
          title="Phone number"
          value={me.phone || authPhone || "Not added"}
          chevron={false}
        />
        <ActionRow
          Icon={BadgeCheck}
          title="Verification badge"
          note="Included with the ₹99 badge plan"
          onSelect={() =>
            navigate({ to: "/settings/$section", params: { section: "premium" } })
          }
        />
      </Group>

      <Button
        className="mt-6 w-full"
        disabled={!usernameOk || saving.current}
        onClick={() => {
          if (!usernameOk || saving.current) return;
          saving.current = true;
          try {
            // Username uniqueness is owned by the database: the profile write
            // below is rejected server-side when the handle is taken.
            setMe({
              name: form.name,
              username: form.username ? `@${form.username}` : "",
              bio: form.bio,
              location: form.location,
              photo: form.photo,
              private: form.private,
            });
            setSettings({ privateAccount: form.private });
            setSaved(true);
            notify("Profile updated");
            navigate({ to: "/profile" });
          } catch {
            saving.current = false;
          }
        }}
      >
        {saved ? "Saved" : "Save changes"}
      </Button>
    </>
  );
}

/* ---------------- Privacy ---------------- */

function PrivacySection() {
  const navigate = useNavigate();
  const { settings, setSettings, setMe, require: requireLimit, limits, notify } = useApp();
  const privateAccount = settings.privateAccount;
  const setPrivate = (v: boolean) => {
    setSettings({ privateAccount: v });
    setMe({ private: v });
  };

  const lastSeen = settings.lastSeen;
  const setLastSeen = (v: string) => setSettings({ lastSeen: v });
  const messages = settings.whoCanMessage;
  const setMessages = (v: string) => setSettings({ whoCanMessage: v });
  const readReceipts = settings.readReceipts;
  const setReadReceipts = (v: boolean) => setSettings({ readReceipts: v });
  const tagging = settings.tagging;
  const setTagging = (v: boolean) => setSettings({ tagging: v });
  const advanced =
    (k: "hideProfilePhoto" | "screenshotBlock") => (v: boolean) => {
      if (!requireLimit("advancedPrivacy")) return;
      setSettings({ [k]: v });
    };
  return (
    <>
      <Group label="Account">
        <ToggleRow
          Icon={Lock}
          title="Private account"
          note="Only approved followers see your profile"
          on={privateAccount}
          onChange={setPrivate}
        />
        <ToggleRow
          Icon={Eye}
          title="Read receipts"
          note="Turning this off also hides others' receipts"
          on={readReceipts}
          onChange={setReadReceipts}
        />
        <ToggleRow title="Allow mentions and tags" on={tagging} onChange={setTagging} />
      </Group>

      <Group label="Visibility">
        <ChoiceRow
          title="Last seen and online"
          options={["Everyone", "Contacts", "Nobody"]}
          value={lastSeen}
          onChange={setLastSeen}
        />
        <ChoiceRow
          title="Who can message you"
          options={["Everyone", "Followers", "Nobody"]}
          value={messages}
          onChange={setMessages}
        />
      </Group>

      <Group label={limits.advancedPrivacy ? "Advanced privacy" : "Advanced privacy · Premium"}>
        <ToggleRow
          Icon={Eye}
          title="Hide profile photo from non-followers"
          note={limits.advancedPrivacy ? "" : "Requires Premium"}
          on={settings.hideProfilePhoto}
          onChange={advanced("hideProfilePhoto")}
        />
        <ToggleRow
          Icon={Lock}
          title="Block screenshots in chats"
          note={limits.advancedPrivacy ? "" : "Requires Premium"}
          on={settings.screenshotBlock}
          onChange={advanced("screenshotBlock")}
        />
      </Group>

      <Group label="Restrictions">
        <ActionRow
          Icon={UserX}
          title="Blocked users"
          onSelect={() => navigate({ to: "/settings/$section", params: { section: "blocked" } })}
        />
        <ActionRow
          Icon={Flag}
          title="Restricted accounts"
          onSelect={() =>
            navigate({ to: "/settings/$section", params: { section: "restricted" } })
          }
        />
      </Group>
      <InfoNote>Every message and call on N Connect is end-to-end encrypted by default.</InfoNote>
    </>
  );
}

/* ---------------- Notifications ---------------- */

function NotificationsSection() {
  const { settings, setSettings } = useApp();
  const state = settings.notifications as Record<string, boolean>;
  const set = (k: string) => (v: boolean) =>
    setSettings({ notifications: { ...settings.notifications, [k]: v } });
  return (
    <>
      <Group label="Conversations">
        <ToggleRow
          Icon={MessageCircle}
          title="Direct messages"
          on={Boolean(state["messages"])}
          onChange={set("messages")}
        />
        <ToggleRow title="Group messages" on={Boolean(state["groups"])} onChange={set("groups")} />
        <ToggleRow
          Icon={Phone}
          title="Voice calls"
          on={Boolean(state["calls"])}
          onChange={set("calls")}
        />
        <ToggleRow
          Icon={Send}
          title="Message requests"
          on={Boolean(state["requests"])}
          onChange={set("requests")}
        />
      </Group>

      <Group label="People">
        <ToggleRow
          Icon={UserRound}
          title="New followers and requests"
          on={Boolean(state["followers"])}
          onChange={set("followers")}
        />
        <ToggleRow
          Icon={Star}
          title="Profile likes"
          on={Boolean(state["likes"])}
          onChange={set("likes")}
        />
        <ToggleRow
          Icon={ShieldCheck}
          title="Security alerts"
          on={Boolean(state["security"])}
          onChange={set("security")}
        />
      </Group>

      <Group label="How they arrive">
        <ToggleRow
          Icon={Bell}
          title="Show message preview"
          on={Boolean(state["preview"])}
          onChange={set("preview")}
        />
        <ToggleRow title="Vibrate" on={Boolean(state["vibrate"])} onChange={set("vibrate")} />
        <ToggleRow title="Sound" on={Boolean(state["sound"])} onChange={set("sound")} />
      </Group>
    </>
  );
}

/* ---------------- Chat ---------------- */

function ChatSection() {
  const {
    settings,
    setSettings,
    limits,
    require: requireLimit,
    chats,
    removeChat,
    notify,
  } = useApp();
  const disappearing = settings.defaultDisappearing;
  const setDisappearing = (v: string) => {
    if (!limits.disappearing.includes(v) && !requireLimit("disappearing60d")) return;
    setSettings({ defaultDisappearing: v });
  };
  const autoDownload = settings.autoDownload;
  const setAutoDownload = (v: string) => setSettings({ autoDownload: v });
  const state = settings.chat as Record<string, boolean>;
  const set = (k: string) => (v: boolean) => setSettings({ chat: { ...settings.chat, [k]: v } });
  return (
    <>
      <Group label="Messages">
        <ChoiceRow
          title="Default disappearing messages"
          options={[
            ...limits.disappearing,
            ...(limits.disappearing.includes("60 days") ? [] : ["60 days"]),
          ]}
          value={disappearing}
          onChange={setDisappearing}
        />
        <ToggleRow
          Icon={Timer}
          title="Typing indicator"
          on={Boolean(state["typing"])}
          onChange={set("typing")}
        />
        <ToggleRow
          title="Enter key sends message"
          on={Boolean(state["enter"])}
          onChange={set("enter")}
        />
        <ToggleRow
          title="Spell check"
          on={Boolean(state["spellcheck"])}
          onChange={set("spellcheck")}
        />
      </Group>

      <Group label="Media">
        <ChoiceRow
          title="Auto-download media"
          options={["Never", "Wi-Fi only", "Always"]}
          value={autoDownload}
          onChange={setAutoDownload}
        />
        <ToggleRow
          Icon={ImageIcon}
          title="Save received media to gallery"
          on={Boolean(state["saveMedia"])}
          onChange={set("saveMedia")}
        />
      </Group>

      <Group label="Organise">
        <ToggleRow
          title="Keep chats archived"
          on={Boolean(state["archiveKeep"])}
          onChange={set("archiveKeep")}
        />
        <ActionRow
          Icon={Trash2}
          title="Clear all chats"
          danger
          chevron={false}
          onSelect={() => {
            chats.forEach((c) => removeChat(c.id));
            notify("All chats cleared");
          }}
        />
      </Group>
    </>
  );
}

/* ---------------- Appearance ---------------- */

const backgrounds = ["Petals", "Plain", "Peach", "Sky", "Custom Image"];

function AppearanceSection() {
  const { settings, setSettings, limits, require: requireLimit, notify } = useApp();
  const customInput = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingUrl, setPendingUrl] = useState("");
  const [savedUrl, setSavedUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const bg = settings.background;
  const setBg = (v: string) => {
    if (v === "Custom Image") {
      if (settings.customBackgroundPath) setSettings({ background: v });
      else customInput.current?.click();
      return;
    }
    setSettings({ background: v });
  };
  const size = settings.textSize;
  const setSize = (v: string) => setSettings({ textSize: v });
  const bubbles = settings.bubble;
  const setBubbles = (v: string) => setSettings({ bubble: v });
  const motion = !settings.reduceMotion;
  const setMotion = (v: boolean) => setSettings({ reduceMotion: !v });
  // Premium chat customization goes through the one entitlement system: a
  // locked option opens the existing Premium sheet and nothing is saved.
  const bubbleColour = settings.bubbleColour || "Classic";
  const chatFont = resolvedChatFont(settings.chatFont, limits.chatCustomization);
  const premiumChoice = (k: "bubbleColour" | "chatFont") => (v: string) => {
    const locked =
      k === "chatFont"
        ? isChatFontLocked(v, limits.chatCustomization)
        : isBubbleColourLocked(v, limits.chatCustomization);
    if (locked && !requireLimit("chatCustomization")) return;
    setSettings({ [k]: v });
  };

  useEffect(() => {
    let active = true;
    if (!settings.customBackgroundPath) {
      setSavedUrl("");
      return;
    }
    void resolveAppearanceBackground(settings.customBackgroundPath).then((url) => {
      if (active) setSavedUrl(url ?? "");
    });
    return () => {
      active = false;
    };
  }, [settings.customBackgroundPath]);

  useEffect(() => {
    if (!pendingFile) {
      setPendingUrl("");
      return;
    }
    const url = URL.createObjectURL(pendingFile);
    setPendingUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const saveCustom = async () => {
    if (!pendingFile || uploading) return;
    setUploading(true);
    const previous = settings.customBackgroundPath;
    try {
      const path = await uploadAppearanceBackground(pendingFile);
      const saved = await saveSettings({
        ...settings,
        background: "Custom Image",
        customBackgroundPath: path,
      });
      if (!saved) {
        await removeAppearanceBackground(path);
        throw new Error("Settings were not saved");
      }
      setSettings({ background: "Custom Image", customBackgroundPath: path });
      setPendingFile(null);
      if (previous && previous !== path) void removeAppearanceBackground(previous);
      notify("Chat background saved");
    } catch {
      notify("Background couldn't be saved. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const removeCustom = async () => {
    const previous = settings.customBackgroundPath;
    const saved = await saveSettings({
      ...settings,
      background: "Petals",
      customBackgroundPath: "",
    });
    if (!saved) {
      notify("Background couldn't be removed. Try again.");
      return;
    }
    setPendingFile(null);
    setSettings({ background: "Petals", customBackgroundPath: "" });
    if (previous) await removeAppearanceBackground(previous);
    notify("Custom background removed");
  };

  const previewUrl = pendingUrl || (bg === "Custom Image" ? savedUrl : "");
  const bubbleShape =
    bubbles === "Square"
      ? "rounded-[5px]"
      : bubbles === "Soft"
        ? "rounded-[12px]"
        : "rounded-[18px]";
  const messageSize = size === "Small" ? "text-[12px]" : size === "Large" ? "text-[15px]" : "text-[13px]";
  return (
    <>
      <section className="mt-5 overflow-hidden rounded-[22px] border border-line shadow-soft">
        <div
          className="relative h-[190px] p-3"
          style={{
            backgroundImage: previewUrl ? `url(${previewUrl})` : bg === "Petals" ? `url(${chatPetals})` : "none",
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundColor:
              bg === "Peach"
                ? "var(--peach)"
                : bg === "Sky"
                  ? "var(--sky)"
                  : bg === "Plain"
                    ? "var(--muted)"
                    : undefined,
          }}
        >
          <span
            className={`inline-block max-w-[70%] border border-line px-3 py-2 shadow-soft ${bubbleShape} ${messageSize}`}
            style={{
              ...bubbleStyle(bubbleColour, false, limits.chatCustomization),
              fontFamily: chatFontStack(chatFont),
            }}
          >
            This is how your chats look.
          </span>
          <span
            className={`mt-2 ml-auto block max-w-[70%] px-3 py-2 text-right ${bubbleShape} ${messageSize}`}
            style={{
              ...bubbleStyle(bubbleColour, true, limits.chatCustomization),
              fontFamily: chatFontStack(chatFont),
            }}
          >
            Clean and quiet.
          </span>
        </div>
      </section>

      <Group label="Chat background">
        <ChoiceRow title="Background" options={backgrounds} value={bg} onChange={setBg} />
        <li className="px-4 pb-4">
          <input
            ref={customInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setPendingFile(file);
              event.target.value = "";
            }}
          />
          {(pendingFile || settings.customBackgroundPath) && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => customInput.current?.click()}>
                <Camera size={15} />
                {settings.customBackgroundPath ? "Replace image" : "Choose image"}
              </Button>
              {pendingFile && (
                <Button type="button" disabled={uploading} onClick={() => void saveCustom()}>
                  <CloudUpload size={15} />
                  {uploading ? "Saving…" : "Save image"}
                </Button>
              )}
              {pendingFile && (
                <Button type="button" variant="secondary" onClick={() => setPendingFile(null)}>
                  Cancel
                </Button>
              )}
              {settings.customBackgroundPath && (
                <Button type="button" variant="secondary" onClick={() => void removeCustom()}>
                  <Trash2 size={15} />
                  Remove image
                </Button>
              )}
            </div>
          )}
        </li>
      </Group>

      <Group label="Text">
        <ChoiceRow
          title="Message text size"
          options={["Small", "Default", "Large"]}
          value={size}
          onChange={setSize}
        />
        <ChoiceRow
          title="Bubble shape"
          options={["Rounded", "Soft", "Square"]}
          value={bubbles}
          onChange={setBubbles}
        />
        <ToggleRow Icon={Type} title="Reduce motion" on={!motion} onChange={(v) => setMotion(!v)} />
      </Group>
      <Group
        label={
          limits.chatCustomization
            ? "Premium chat customization"
            : "Premium chat customization · Premium"
        }
      >
        <ChoiceRow
          title="Bubble colour"
          options={BUBBLE_COLOURS.map((c) => c.name)}
          value={bubbleColour}
          onChange={premiumChoice("bubbleColour")}
          locked={(o) => isBubbleColourLocked(o, limits.chatCustomization)}
          swatch={(o) => BUBBLE_COLOURS.find((c) => c.name === o)?.swatch}
        />
        <ChoiceRow
          title="Chat font"
          options={CHAT_FONTS.map((f) => f.name)}
          value={chatFont}
          onChange={premiumChoice("chatFont")}
          locked={(o) => isChatFontLocked(o, limits.chatCustomization)}
          optionStyle={(o) => ({ fontFamily: chatFontStack(o) })}
        />
      </Group>
      <InfoNote>Appearance changes follow your account across devices.</InfoNote>
    </>
  );
}

/* ---------------- Storage ---------------- */

type StorageItem = { label: string; value: number; tone: string };

function StorageSection() {
  const { settings, setSettings, clearCache, clearedCache, deleteAllMedia } = useApp();
  const [storage, setStorage] = useState<StorageItem[]>([]);
  // Measured from this account's real server data after mount.
  useEffect(() => {
    let cancelled = false;
    void accountStorageUsage().then((items) => {
      if (!cancelled) setStorage(items);
    });
    return () => {
      cancelled = true;
    };
  }, [clearedCache]);
  const total = storage.reduce((s, i) => s + i.value, 0);
  const cleared = clearedCache;
  const quality = settings.callQuality;
  const setQuality = (v: string) => setSettings({ callQuality: v });
  const lowData = settings.lowData;
  const setLowData = (v: boolean) => setSettings({ lowData: v });
  return (
    <>
      <section className="mt-5">
        <p className="text-[13px] text-ink-2">
          {total > 0 ? (
            <>
              <span className="text-[20px] font-semibold text-ink">
                {(total / 1024).toFixed(2)} GB
              </span>{" "}
              used by N Connect
            </>
          ) : (
            <>
              <span className="text-[20px] font-semibold text-ink">—</span> Storage usage
              unavailable
            </>
          )}
        </p>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
          {storage.map((s) => (
            <span
              key={s.label}
              className={s.tone}
              style={{ width: `${(s.value / total) * 100}%` }}
            />
          ))}
        </div>
      </section>

      <Group label="Breakdown">
        {storage.length === 0 ? (
          <li className="px-1 py-3.5 text-[13px] text-ink-2">No usage data yet.</li>
        ) : (
          storage.map((s) => (
            <ActionRow key={s.label} title={s.label} value={`${s.value} MB`} chevron={false} />
          ))
        )}
      </Group>

      <Group label="Network">
        <ChoiceRow
          title="Call quality"
          options={["Data saver", "Standard", "High"]}
          value={quality}
          onChange={setQuality}
        />
        <ToggleRow Icon={Wifi} title="Use less data for calls" on={lowData} onChange={setLowData} />
      </Group>

      <Group>
        <ActionRow
          Icon={RefreshCw}
          title={cleared ? "Cache cleared" : "Clear cache"}
          note="Keeps your messages"
          chevron={false}
          onSelect={() => clearCache()}
        />
        <ActionRow
          Icon={Trash2}
          title="Delete all media"
          danger
          chevron={false}
          onSelect={() => deleteAllMedia()}
        />
      </Group>
    </>
  );
}

/* ---------------- Security ---------------- */

type Session = {
  id: string;
  device: string;
  place: string;
  time: string;
  Icon: typeof Smartphone;
  current?: boolean;
};

function SecuritySection() {
  const { sessions, endSession, endOtherSessions, settings, setSettings, notify, authPhone } = useApp();
  const list: Session[] = sessions.map((s) => ({
    ...s,
    Icon:
      s.device.toLowerCase().includes("mac") || s.device.toLowerCase().includes("windows")
        ? Laptop
        : Smartphone,
  }));
  const alerts = settings.loginAlerts;
  const setAlerts = (v: boolean) => setSettings({ loginAlerts: v });
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Group label="Protection">
        <ToggleRow Icon={ShieldCheck} title="Login alerts" on={alerts} onChange={setAlerts} />
        <ActionRow
          Icon={Lock}
          title="Sign-in security"
          note={authPhone ? `One-time codes are sent to ${authPhone}` : "Protected by one-time phone codes"}
          chevron={false}
        />
      </Group>

      <Group label="Active sessions">
        {list.length === 0 && (
          <li className="px-1 py-3.5 text-[13px] text-ink-2">No session information available.</li>
        )}
        {list.map((s) => (
          <li
            key={s.id}
            className="flex items-center gap-3 px-1 py-3.5"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted text-ink">
              <s.Icon size={17} strokeWidth={1.8} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{s.device}</span>
              <span className="block truncate text-[11.5px] text-ink-2">
                {s.place} · {s.time}
              </span>
            </span>
            {s.current ? (
              <span className="shrink-0 text-[11px] font-semibold text-emerald-600">Current</span>
            ) : (
              <button
                onClick={() => {
                  endSession(s.id);
                  notify("Device logged out");
                }}
                className="h-8 shrink-0 rounded-full border border-line bg-surface px-3 text-[12px] font-semibold text-red-500"
              >
                Log out
              </button>
            )}
          </li>
        ))}
      </Group>

      <Group>
        <ActionRow
          Icon={Trash2}
          title="Log out of all other devices"
          danger
          chevron={false}
          onSelect={() => setConfirm(true)}
        />
      </Group>

      <GlassSheet
        open={confirm}
        title="Log out everywhere else?"
        onClose={() => setConfirm(false)}
        actions={[
          {
            label: "Log out all other devices",
            Icon: Trash2,
            tone: "danger",
            onSelect: () => {
              endOtherSessions();
              notify("Logged out everywhere else");
            },
          },
          { label: "Cancel" },
        ]}
      />
    </>
  );
}

/* ---------------- Premium ---------------- */

const perks = [
  // Colored premium verification badge, matching the profile screen design.
  { label: "Verification Badge", Icon: BadgeCheck, iconClass: "text-emerald-600", strokeWidth: 2 },
  { label: "Higher daily limits", Icon: Gauge },
  { label: "Premium chat customization", Icon: MessageCircle },
  { label: "Advanced privacy controls", Icon: Shield },
  { label: "Longer disappearing-message timer", Icon: Timer },
  { label: "Higher image sending limit", Icon: ImageIcon },
  { label: "Unlimited voice calls", Icon: Phone },
  { label: "Unlimited video calls", Icon: Video },
];

function PremiumSection() {
  const {
    isPremium,
    upgrade,
    cancelPremium,
    creditsPlanActive,
    verificationActive,
    verificationExpiresAt,
    creditsLeft,
    dailyCreditsLeft,
    extraCredits,
    buyExtraCredits,
  } = useApp();

  const activeOf = (id: PlanId) => (id === "credits" ? creditsPlanActive : verificationActive);

  return (
    <section className="mt-8 pb-8">
      <Crown size={24} strokeWidth={1.6} className="text-ink" aria-hidden="true" />
      <h2 className="mt-4 max-w-[320px] text-[28px] font-semibold leading-[1.12] text-ink">
        N Connect Premium
      </h2>
      <p className="mt-2 max-w-[330px] text-[13px] leading-[1.55] text-ink-2">
        Choose either plan to unlock all existing Premium and Pro features.
      </p>
      {isPremium && <p className="mt-2 text-[12px] font-semibold text-emerald-600">Premium active</p>}

      <div className="mt-9 space-y-8">
        {PLAN_LIST.map((option) => (
          <section key={option.id} className="flex items-start gap-3.5">
            <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center text-ink">
              {option.id === "credits" ? <Gauge size={19} strokeWidth={1.7} /> : <BadgeCheck size={19} strokeWidth={1.7} className="text-emerald-600" />}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-[17px] font-semibold text-ink">
                {option.price} {option.name}
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{option.note}</p>
            {activeOf(option.id) ? (
                <p className="mt-3 text-[12px] font-semibold text-brand">
                Active
                {option.id === "verification" && verificationExpiresAt
                  ? ` · until ${new Date(verificationExpiresAt).toLocaleDateString()}`
                  : ""}
              </p>
            ) : (
              <Button
                  className="mt-3 h-9 w-auto px-4 text-[12px]"
                onClick={() => upgrade(option.id)}
              >
                  Purchase
              </Button>
            )}
            </div>
          </section>
        ))}
      </div>

      {creditsPlanActive && (
        <div className="mt-7 border-l-2 border-brand pl-3">
          <p className="text-[12.5px] text-ink">
            {creditsLeft} Connect Credits left today
            {extraCredits > 0 ? ` · ${extraCredits} extra` : ""}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-2">
            {DAILY_CONNECT_CREDITS} credits refresh every day. Unused daily credits do not carry
            over.
          </p>
          {dailyCreditsLeft === 0 && (
            <Button
              className="mt-2 h-8 px-3 text-[12px]"
              onClick={() => buyExtraCredits(EXTRA_CREDIT_MIN)}
            >
              Buy {EXTRA_CREDIT_MIN} credits · ₹{EXTRA_CREDIT_MIN * EXTRA_CREDIT_PRICE}
            </Button>
          )}
        </div>
      )}

      <div className="mt-8">
        <h3 className="text-[12px] font-semibold uppercase text-ink-2">Included with either plan</h3>
      <ul className="mt-3 grid grid-cols-1 gap-y-1 sm:grid-cols-2">
        {perks.map(({ label, Icon, iconClass, strokeWidth }) => (
          <li key={label} className="flex items-center gap-3 py-1.5">
            <span className={`grid h-6 w-6 shrink-0 place-items-center ${iconClass ?? "text-ink-2"}`}>
              <Icon size={15} strokeWidth={strokeWidth ?? 1.8} />
            </span>
            <span className="text-[12.5px] text-ink">{label}</span>
          </li>
        ))}
      </ul>
      </div>

      {isPremium && (
        <Button className="mt-1 h-9 px-4 text-[12px]" onClick={cancelPremium}>
          Cancel plan
        </Button>
      )}
    </section>
  );
}

/* ---------------- Support ---------------- */

function SupportSection() {
  const { notify, reportUser } = useApp();
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <>
      <Group label="Send feedback">
        <li className="px-1 py-3.5">
          <Label>What can we improve?</Label>
          <textarea
            rows={4}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSent(false);
            }}
            placeholder="Tell us what happened…"
            className="w-full rounded-[18px] border border-line bg-surface p-3.5 text-[13.5px] text-ink shadow-soft outline-none placeholder:text-placeholder focus-blue"
          />
          <Button
            className="mt-3 w-full"
            disabled={!text.trim()}
            onClick={() => {
              // Saved with the app's reports so nothing is lost on reload.
              reportUser("n-connect-feedback", text.trim());
              setText("");
              setSent(true);
              notify("Feedback sent");
            }}
          >
            {sent ? "Thanks, sent" : "Send feedback"}
          </Button>
        </li>
      </Group>
      <InfoNote>Feedback is stored with your account and read by the team.</InfoNote>
    </>
  );
}

/* ---------------- About ---------------- */

function AboutSection() {
  const { notify } = useApp();
  const [checking, setChecking] = useState(false);
  return (
    <>
      <section className="mt-5 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-[22px] border border-line bg-surface text-[22px] font-semibold text-ink shadow-soft">
          N
        </span>
        <p className="mt-3 text-[15px] font-semibold text-ink">N Connect</p>
        <p className="text-[12px] text-ink-2">Version 1.4.0 (build 2260)</p>
      </section>

      <Group label="More">
        <ActionRow
          Icon={Send}
          title="Share the app"
          chevron={false}
          onSelect={async () => {
            const link = window.location.origin;
            const ok = await copyText(link);
            notify(ok ? "Invite link copied" : "Could not copy the link");
          }}
        />
        <ActionRow
          Icon={RefreshCw}
          title="Check for updates"
          {...(checking ? { value: "Checking…" } : {})}
          chevron={false}
          onSelect={async () => {
            if (checking) return;
            setChecking(true);
            try {
              const registration = await navigator.serviceWorker?.getRegistration();
              await registration?.update();
              window.location.reload();
            } catch {
              setChecking(false);
              notify("Couldn't check for updates");
            }
          }}
        />
      </Group>
      <InfoNote>Made quietly in India. No ads, no trackers.</InfoNote>
    </>
  );
}

/* ---------------- Account & Data ---------------- */

function AccountDataSection() {
  const { notify, setSettings } = useApp();
  const navigate = useNavigate();
  return (
    <>
      <Group label="Your data">
        <ActionRow
          Icon={Download}
          title="Download your data"
          note="Your profile, chats, contacts and settings as a file"
          chevron={false}
          onSelect={() => {
            void (async () => {
              const ok = await downloadAccountData();
              notify(ok ? "Your data file was downloaded" : "There is no stored data yet");
            })();
          }}
        />
      </Group>

      <Group label="Availability">
        <ActionRow
          Icon={UserRound}
          title="Deactivate temporarily"
          note="Hide your profile, keep your data"
          onSelect={() => {
            setSettings({ privateAccount: true, nearbyVisible: false, hideProfilePhoto: true });
            notify("Account hidden. Your chats are kept.");
            navigate({ to: "/settings/$section", params: { section: "privacy" } });
          }}
        />
        <ActionRow
          Icon={Trash2}
          title="Delete account permanently"
          danger
          onSelect={() =>
            navigate({ to: "/settings/$section", params: { section: "delete-account" } })
          }
        />
      </Group>
      <InfoNote>Exports are encrypted and expire after 7 days.</InfoNote>
    </>
  );
}

/* ---------------- Blocked users ---------------- */

function BlockedSection() {
  const { blocked, unblock, notify } = useApp();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = blocked.filter(
    (b) => !q || b.name.toLowerCase().includes(q) || b.username.includes(q),
  );
  return (
    <>
      <div className="relative mt-5">
        <Search
          size={17}
          strokeWidth={1.8}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search blocked users"
          className="h-11 w-full rounded-[23px] border border-line bg-surface pl-11 pr-4 text-[14px] text-ink shadow-soft outline-none placeholder:text-placeholder focus-blue"
        />
      </div>

      {list.length === 0 ? (
        <div className="mt-20 text-center">
          <p className="text-[13px] font-medium text-ink">
            {blocked.length === 0 ? "Nobody is blocked" : "No matches"}
          </p>
          <p className="mt-1 text-[12px] text-ink-2">Blocked people can't message or call you.</p>
        </div>
      ) : (
        <Group label={`${blocked.length} blocked`}>
          {list.map((b) => (
            <li
              key={b.id}
              className="flex items-center gap-3 px-1 py-3"
            >
              <Avatar name={b.name} seed={Number(b.id)} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{b.name}</span>
                <span className="block truncate text-[11.5px] text-ink-2">
                  {b.username} · {b.since}
                </span>
              </span>
              <button
                onClick={() => {
                  unblock(b.id);
                  notify(`${b.name} unblocked`);
                }}
                className="h-8 shrink-0 rounded-full border border-line bg-surface px-3.5 text-[12px] font-semibold text-ink"
              >
                Unblock
              </button>
            </li>
          ))}
        </Group>
      )}
      <InfoNote>Unblocking doesn't restore old chats or make them follow you again.</InfoNote>
    </>
  );
}

/* ---------------- Restricted accounts ---------------- */

function RestrictedSection() {
  const { mutedProfiles, people, toggleMuteProfile, notify } = useApp();
  const restricted = mutedProfiles.map((username) => {
    const person = people.find((candidate) => candidate.username.toLowerCase() === username);
    return {
      username,
      name: person?.name ?? username.replace(/^@/, ""),
      id: person?.id ?? username,
    };
  });

  if (restricted.length === 0) {
    return (
      <div className="mt-20 text-center">
        <p className="text-[13px] font-medium text-ink">Nobody is restricted</p>
        <p className="mt-1 text-[12px] text-ink-2">Restricted accounts cannot send you alerts.</p>
      </div>
    );
  }

  return (
    <>
      <Group label={`${restricted.length} restricted`}>
        {restricted.map((person) => (
          <li key={person.username} className="flex items-center gap-3 px-1 py-3">
            <Avatar name={person.name} seed={Number(person.id)} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium text-ink">{person.name}</span>
              <span className="block truncate text-[11.5px] text-ink-2">{person.username}</span>
            </span>
            <Button
              variant="secondary"
              className="h-8 px-3.5 text-[12px]"
              onClick={() => {
                toggleMuteProfile(person.username);
                notify(`${person.name} unrestricted`);
              }}
            >
              Unrestrict
            </Button>
          </li>
        ))}
      </Group>
      <InfoNote>Restricting an account silences its alerts without blocking it.</InfoNote>
    </>
  );
}

/* ---------------- Delete account ---------------- */

const reasons = [
  "Taking a break",
  "Privacy concerns",
  "Too many notifications",
  "Found another app",
  "Other",
];

function DeleteAccountSection() {
  const navigate = useNavigate();
  const { deleteAccount, notify, settings, setSettings } = useApp();
  const deleteRemoteAccount = useServerFn(deleteCurrentAccount);
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [sheet, setSheet] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  return (
    <>
      <div className="mt-5 flex items-center gap-1.5">
        {[1, 2, 3].map((s) => (
          <span
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-ink" : "bg-line"}`}
          />
        ))}
      </div>

      {step === 1 && (
        <>
          <p className="mt-5 text-[14px] font-semibold text-ink">What happens when you delete</p>
          <ul className="mt-3 space-y-0.5">
            {[
              "Your profile, followers and username are removed",
              "All chats, media and backups are erased",
              "Your phone number is freed after 30 days",
              "Premium billing stops immediately",
            ].map((t) => (
              <li
                key={t}
                className="flex items-start gap-3 px-1 py-3.5"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                <span className="text-[13.5px] text-ink">{t}</span>
              </li>
            ))}
          </ul>
          <Group label="Instead you could">
            <ActionRow
              title="Deactivate temporarily"
              note="Hide your account, keep your chats"
              onSelect={() => {
                // Real privacy lockdown: private account, off the nearby map and photo hidden.
                setSettings({
                  privateAccount: true,
                  nearbyVisible: false,
                  hideProfilePhoto: true,
                });
                notify("Account hidden. Your chats are kept.");
                navigate({ to: "/settings/$section", params: { section: "privacy" } });
              }}
            />
            <ActionRow
              title="Turn off all notifications"
              onSelect={() => {
                const off = Object.fromEntries(
                  Object.keys(settings.notifications).map((k) => [k, false]),
                );
                setSettings({ notifications: off });
                notify("All notifications turned off");
              }}
            />
          </Group>
          <Button className="mt-6 w-full" onClick={() => setStep(2)}>
            Continue
          </Button>
        </>
      )}

      {step === 2 && (
        <>
          <p className="mt-5 text-[14px] font-semibold text-ink">Why are you leaving?</p>
          <div className="mt-3 space-y-0.5">
            {reasons.map((r) => (
              <button
                key={r}
                onClick={() => setReason(r)}
                className="flex w-full items-center gap-3 px-1 py-3.5 text-left"
              >
                <span
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${
                    reason === r ? "border-ink bg-ink text-background" : "border-line"
                  }`}
                >
                  {reason === r && <Check size={12} strokeWidth={2.6} />}
                </span>
                <span className="text-[13.5px] text-ink">{r}</span>
              </button>
            ))}
          </div>
          <Button className="mt-6 w-full" disabled={!reason} onClick={() => setStep(3)}>
            Continue
          </Button>
          <button
            onClick={() => setStep(1)}
            className="mt-3 block w-full text-center text-[12px] text-ink-2"
          >
            Go back
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <p className="mt-5 text-[14px] font-semibold text-ink">Confirm deletion</p>
          <div className="mt-3">
            <div>
              <Label>Type DELETE to confirm</Label>
              <Field
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
              />
            </div>
          </div>
          <Button
            className="mt-6 w-full bg-red-500 text-white"
            disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"}
            onClick={() => setSheet(true)}
          >
            Delete my account
          </Button>
          <button
            onClick={() => setStep(2)}
            className="mt-3 block w-full text-center text-[12px] text-ink-2"
          >
            Go back
          </button>
          {deleteError && <p className="mt-3 text-center text-[12px] text-danger">{deleteError}</p>}
          <InfoNote>You'll be signed out of every device right away.</InfoNote>
        </>
      )}

      <GlassSheet
        open={sheet}
        title="Delete account permanently?"
        onClose={() => setSheet(false)}
        actions={[
          {
            label: deleting ? "Deleting…" : "Yes, delete everything",
            Icon: Trash2,
            tone: "danger",
            onSelect: async () => {
              if (deleting) return;
              setDeleting(true);
              setDeleteError("");
              try {
                await deleteRemoteAccount();
                await supabase.auth.signOut();
                deleteAccount();
                notify("Account deleted");
                await navigate({ to: "/login" });
              } catch (error) {
                setDeleting(false);
                setDeleteError(error instanceof Error ? error.message : "We couldn't delete your account. Please try again.");
              }
            },
          },
          { label: "Keep my account" },
        ]}
      />
    </>
  );
}
