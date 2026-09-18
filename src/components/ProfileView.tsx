import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { copyText } from "@/lib/clipboard";
import {
  ArrowLeft,
  Ban,
  BadgeCheck,
  Check,
  Flag,
  Heart,
  Link2,
  Lock,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  QrCode,
  Share2,
  UserRoundX,
  X,
} from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { GlassSheet } from "@/components/GlassSheet";
import { AdSlot } from "@/components/AdSlot";
import { useApp, key as handleKey } from "@/lib/store";
import { useProfileLike } from "@/lib/notifications/use-profile-like";
import type { Person, Profile } from "@/data/types";

function Stat({ value, label, onSelect }: { value: number; label: string; onSelect?: () => void }) {
  return (
    <button type="button" onClick={onSelect} className="flex-1 text-center">
      <p className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-2">{label}</p>
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-muted px-3 text-[12px] font-medium text-ink-2">
      {children}
    </span>
  );
}

const blueBtn =
  "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[21px] bg-brand px-4 text-[13px] font-semibold text-white transition-transform active:scale-[0.98]";
const grayBtn =
  "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[21px] bg-muted px-4 text-[13px] font-semibold text-ink-2 transition-transform active:scale-[0.98]";
const outlineBtn =
  "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[21px] border border-line bg-surface px-4 text-[13px] font-semibold text-ink shadow-soft transition-transform active:scale-[0.98]";

type ListKind = "followers" | "following" | "likes" | null;

export function ProfileView({ profile, own }: { profile: Profile; own?: boolean }) {
  const navigate = useNavigate();
  const {
    relationOf,
    setRelation,
    notify,
    blockPerson,
    isBlocked,
    unblock,
    blocked,
    canMessage,
    require: requireLimit,
    followRequests,
    resolveFollowRequest,
    verificationActive,
    chatFor,
    people,
    isMuted,
    toggleMuteProfile,
    reportUser,
  } = useApp();

  const relation = own ? "following" : relationOf(profile.username);
  const like = useProfileLike(profile.username);
  const liked = own ? false : like.liked;
  const [sheet, setSheet] = useState<null | "more" | "share" | "following" | "report">(null);
  const [list, setList] = useState<ListKind>(null);

  const locked = Boolean(profile.private) && relation !== "following";
  const blockedNow = !own && isBlocked(profile.username);
  const mutedNow = !own && isMuted(profile.username);

  /** Copies the profile's public link and only confirms when it really copied. */
  const copyProfileLink = async () => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const ok = await copyText(`${origin}/profile/${handleKey(profile.username)}`);
    notify(ok ? "Profile link copied" : "Could not copy the link");
  };

  const openMessage = () => {
    if (blockedNow) {
      notify("Unblock to send a message");
      return;
    }
    const existing = chatFor(profile.username);
    if (!existing && !requireLimit("initiateMessage")) return;
    navigate({ to: "/chat/$username", params: { username: handleKey(profile.username) } });
  };

  // Relationship lists come from real local data only — never seeded people.
  const listPeople: Person[] = [];

  return (
    <main className="min-h-screen pb-28 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center justify-between">
          <button
            aria-label="Back"
            onClick={() => navigate({ to: "/home" })}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            <ArrowLeft size={18} strokeWidth={1.8} />
          </button>
          <button
            aria-label="More options"
            onClick={() => setSheet("more")}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            <MoreHorizontal size={18} strokeWidth={1.8} />
          </button>
        </header>

        <section
          className="glass mt-4 rounded-[26px] px-4 pb-4 pt-5"
          style={{ animation: "rise-in 420ms cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <div className="flex flex-col items-center text-center">
            <Avatar
              name={profile.name}
              seed={profile.name.length}
              size={92}
              photo={profile.photo}
              className="ring-2 ring-white/90 shadow-[0_8px_26px_-16px_rgb(0_0_0/0.45)]"
            />
            <h1 className="mt-3 flex items-center gap-1.5 text-[19px] font-semibold tracking-[-0.01em] text-ink">
              {profile.name}
              {(own ? verificationActive : profile.premium) && (
                <BadgeCheck
                  size={16}
                  strokeWidth={2}
                  className="shrink-0 text-emerald-600"
                  aria-label="Verified"
                />
              )}
            </h1>
            <span className="mt-1.5 inline-flex items-center gap-1.5">
              <Pill>
                {profile.username}
                {own && profile.contactId ? ` · ${profile.contactId}` : ""}
              </Pill>
              {own && (
                <Link
                  to="/qr"
                  aria-label="Show my QR code"
                  className="grid h-7 w-7 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
                >
                  <QrCode size={14} strokeWidth={1.9} />
                </Link>
              )}
            </span>
            {locked ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-ink-2">
                <Lock size={13} strokeWidth={1.9} /> This account is private
              </p>
            ) : (
              <p className="mt-3 max-w-[300px] text-[13px] leading-[1.5] text-ink-2">
                {profile.bio}
              </p>
            )}
          </div>

          <div className="mt-4 flex items-center">
            <Stat
              value={profile.followers}
              label="Followers"
              onSelect={() => setList("followers")}
            />
            <span className="h-7 w-px bg-line/80" />
            <Stat
              value={profile.following}
              label="Following"
              onSelect={() => setList("following")}
            />
            <span className="h-7 w-px bg-line/80" />
            <Stat value={profile.likes} label="Profile Likes" onSelect={() => setList("likes")} />
          </div>

          {profile.location && (
            <div className="mt-4 flex justify-center">
              <Pill>
                <MapPin size={13} strokeWidth={1.9} />
                {profile.location}
              </Pill>
            </div>
          )}
        </section>

        {own ? (
          <div className="mt-4 flex gap-2.5">
            <button
              className={outlineBtn}
              onClick={() => navigate({ to: "/settings/$section", params: { section: "account" } })}
            >
              <Pencil size={15} strokeWidth={1.9} />
              Edit Profile
            </button>
            <button className={outlineBtn} onClick={() => setSheet("share")}>
              <Share2 size={15} strokeWidth={1.9} />
              Share Profile
            </button>
          </div>
        ) : (
          <>
            <div className="mt-4 flex gap-2.5">
              {relation === "follow" && (
                <button
                  className={blueBtn}
                  onClick={() => {
                    const next = profile.private ? "requested" : "following";
                    setRelation(profile.username, next);
                    notify(
                      next === "requested" ? "Follow request sent" : `Following ${profile.name}`,
                    );
                  }}
                >
                  Follow
                </button>
              )}
              {relation === "requested" && (
                <button
                  className={grayBtn}
                  onClick={() => {
                    setRelation(profile.username, "follow");
                    notify("Request withdrawn");
                  }}
                >
                  Requested
                </button>
              )}
              {relation === "following" && (
                <button className={blueBtn} onClick={() => setSheet("following")}>
                  Following
                </button>
              )}
              <button className={outlineBtn} disabled={locked} onClick={openMessage}>
                <MessageCircle size={15} strokeWidth={1.9} />
                Message
              </button>
            </div>
            <div className="mt-2.5 flex gap-2.5">
              <button
                className={liked ? grayBtn : outlineBtn}
                disabled={locked || like.pending}
                onClick={() => {
                  const wasLiked = liked;
                  void like.toggle().then(
                    (result) => {
                      if (!result.ok) return notify("Couldn't update the like");
                      notify(wasLiked ? "Like removed" : "Profile liked");
                    },
                    () => notify("Couldn't update the like"),
                  );
                }}
              >
                <Heart
                  size={15}
                  strokeWidth={1.9}
                  className={liked ? "fill-red-500 text-red-500" : ""}
                />
                {liked ? "Profile Liked" : "Like Profile"}
              </button>
              <button className={outlineBtn} onClick={() => setSheet("share")}>
                <Share2 size={15} strokeWidth={1.9} />
                Share
              </button>
            </div>
          </>
        )}

        {!own && (
          <p className="mt-6 text-center text-[11px] text-ink-3">
            {blockedNow
              ? `You blocked ${profile.name.split(" ")[0]}.`
              : `Messages with ${profile.name.split(" ")[0]} are end-to-end encrypted.`}
          </p>
        )}

        {own && (
          <>
            {followRequests.length > 0 && (
              <div className="mt-7">
                <h2 className="text-[13px] font-semibold text-ink">Follow requests</h2>
                <ul className="mt-1 border-y border-line/70">
                  {followRequests.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center gap-3 border-b border-line/60 py-3 last:border-b-0"
                    >
                      <Avatar name={p.name} seed={Number(p.id)} size={42} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">
                          {p.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-ink-2">
                          {p.username}
                        </span>
                      </span>
                      <button
                        aria-label={`Accept ${p.name}`}
                        onClick={() => {
                          resolveFollowRequest(p.id, true);
                          notify("Request accepted");
                        }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-white"
                      >
                        <Check size={15} strokeWidth={2.2} />
                      </button>
                      <button
                        aria-label={`Reject ${p.name}`}
                        onClick={() => {
                          resolveFollowRequest(p.id, false);
                          notify("Request rejected");
                        }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-ink-2"
                      >
                        <X size={15} strokeWidth={2.2} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <AdSlot index={1} />

            {people.length > 0 && (
              <div className="mt-7">
                <h2 className="text-[13px] font-semibold text-ink">Discover profiles</h2>
                <ul className="mt-1 border-y border-line/70">
                  {people.slice(0, 4).map((p) => (
                    <li key={p.id} className="border-b border-line/60 last:border-b-0">
                      <button
                        onClick={() =>
                          navigate({
                            to: "/profile/$username",
                            params: { username: handleKey(p.username) },
                          })
                        }
                        className="flex w-full items-center gap-3 py-3 text-left"
                      >
                        <Avatar name={p.name} seed={Number(p.id)} size={42} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium text-ink">
                            {p.name}
                          </span>
                          <span className="block truncate text-[11.5px] text-ink-2">
                            {p.location}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Screen>

      {/* Followers / Following / Likes lists */}
      <GlassSheet
        open={list !== null}
        title={
          list === "followers" ? "Followers" : list === "following" ? "Following" : "Profile likes"
        }
        onClose={() => setList(null)}
      >
        <ul className="max-h-[46vh] overflow-y-auto px-1.5">
          {listPeople.length === 0 && (
            <li className="px-2 py-3 text-[13px] text-ink-2">Nobody here yet.</li>
          )}
          {listPeople.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  setList(null);
                  navigate({
                    to: "/profile/$username",
                    params: { username: handleKey(p.username) },
                  });
                }}
                className="flex w-full items-center gap-3 rounded-[18px] px-2 py-2.5 text-left active:bg-white/60"
              >
                <Avatar name={p.name} seed={Number(p.id)} size={38} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">
                    {p.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-ink-2">{p.username}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </GlassSheet>

      <GlassSheet
        open={sheet === "share"}
        title="Share profile"
        onClose={() => setSheet(null)}
        actions={[
          { label: "Copy profile link", Icon: Link2, onSelect: copyProfileLink },
          { label: "Share via QR code", Icon: QrCode, onSelect: () => navigate({ to: "/qr" }) },
          {
            label: "Share to a chat",
            Icon: MessageCircle,
            onSelect: () => navigate({ to: "/chat" }),
          },
        ]}
      />
      <GlassSheet
        open={sheet === "following"}
        title={profile.username}
        onClose={() => setSheet(null)}
        actions={[
          {
            label: "Unfollow",
            Icon: UserRoundX,
            tone: "danger",
            onSelect: () => {
              setRelation(profile.username, "follow");
              notify(`Unfollowed ${profile.name}`);
            },
          },
          {
            label: mutedNow ? "Unmute this profile" : "Mute this profile",
            Icon: Ban,
            onSelect: () => {
              const nowMuted = toggleMuteProfile(profile.username);
              setSheet(null);
              notify(nowMuted ? `${profile.name} muted` : `${profile.name} unmuted`);
            },
          },
        ]}
      />
      <GlassSheet
        open={sheet === "report"}
        title={`Report ${profile.name}`}
        onClose={() => setSheet(null)}
        actions={["Spam", "Harassment", "Fake account", "Something else"].map((r) => ({
          label: r,
          Icon: Flag,
          tone: "danger" as const,
          onSelect: () => {
            reportUser(profile.username, r);
            setSheet(null);
            notify(`Reported for ${r.toLowerCase()}`);
          },
        }))}
      />
      <GlassSheet
        open={sheet === "more"}
        onClose={() => setSheet(null)}
        actions={
          own
            ? [
                { label: "Share profile", Icon: Share2, onSelect: () => setSheet("share") },
                {
                  label: "Copy profile link",
                  Icon: Link2,
                  onSelect: copyProfileLink,
                },
                {
                  label: "Privacy settings",
                  Icon: Lock,
                  onSelect: () =>
                    navigate({ to: "/settings/$section", params: { section: "privacy" } }),
                },
              ]
            : [
                { label: "Share profile", Icon: Share2, onSelect: () => setSheet("share") },
                {
                  label: "Copy profile link",
                  Icon: Link2,
                  onSelect: copyProfileLink,
                },
                { label: "Report", Icon: Flag, tone: "danger", onSelect: () => setSheet("report") },
                {
                  label: blockedNow ? "Unblock" : "Block",
                  Icon: Ban,
                  tone: "danger",
                  onSelect: () => {
                    if (blockedNow) {
                      const row = blocked.find(
                        (b) => handleKey(b.username) === handleKey(profile.username),
                      );
                      if (row) unblock(row.id);
                      notify(`${profile.name} unblocked`);
                    } else {
                      blockPerson(profile);
                      notify(`${profile.name} blocked`);
                    }
                  },
                },
              ]
        }
      />
    </main>
  );
}
