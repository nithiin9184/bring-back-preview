import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  Coins,
  Crown,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UserRound,
  Users,
} from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";
import { GlassSheet } from "@/components/GlassSheet";
import { AdSlot } from "@/components/AdSlot";
import { useApp, key as handleKey } from "@/lib/store";
import {
  checkConnectEligibility,
  endConnect,
  readConnectMessages,
  readConnectState,
  requestConnectMatch,
  sendConnectChatMessage,
  subscribeConnect,
  subscribeConnectMessages,
  voteOnConnect,
  type ConnectMessage,
  type ConnectState,
} from "@/lib/connect/connect-service";
import { currentAccountId } from "@/lib/social/social-graph";

type Match = { id: string; name: string; username: string; contactId?: string };

/** Stable avatar seed for a username (the server sends no numeric id). */
function seedOf(username: string): number {
  let h = 0;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return h;
}

/** Re-asks the server for a partner while waiting; also refreshes the heartbeat. */
const WAIT_POLL_MS = 15_000;

export const Route = createFileRoute("/connect")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Connect — N Connect" },
      {
        name: "description",
        content: "Spend a credit and connect with a random person in a temporary encrypted chat.",
      },
      { property: "og:title", content: "Connect — N Connect" },
      {
        property: "og:description",
        content: "Random one-to-one connections with mutual-like profile unlock.",
      },
    ],
  }),
  component: ConnectScreen,
});

type Phase = "idle" | "connecting" | "matched" | "chat" | "ended" | "unavailable";

type Bubble = { id: string; mine: boolean; text: string; time: string };

const rules = [
  { title: "Stay respectful", note: "Abuse ends the connection instantly." },
  { title: "Temporary by default", note: "The chat disappears unless you both like." },
  { title: "Identity stays hidden", note: "Profiles unlock only after both 👍." },
  { title: "One credit per connect", note: "Credits refill every day at midnight." },
];

function now() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function stamp(iso: string) {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? now()
    : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Server-stored session messages as this screen renders them. */
function toBubbles(list: ConnectMessage[]): Bubble[] {
  return list.map((m) => ({ id: m.id, mine: m.mine, text: m.text, time: stamp(m.createdAt) }));
}

function ConnectScreen() {
  const navigate = useNavigate();
  const { me, creditsLeft, limits, spendCredit, showLimit, isPremium, notify } = useApp();
  const [phase, setPhase] = useState<Phase>("idle");
  const [match, setMatch] = useState<Match | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [myVote, setMyVote] = useState<"up" | "down" | null>(null);
  const [theirVote, setTheirVote] = useState<"up" | "down" | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [confirmDown, setConfirmDown] = useState(false);
  const [msgs, setMsgs] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  const reset = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setMatch(null);
    setSessionId(null);
    setMyVote(null);
    setTheirVote(null);
    setUnlocked(false);
    setMsgs([]);
    setDraft("");
  };

  /** Applies what the server says this account's pairing looks like. */
  const applyState = useCallback((state: ConnectState) => {
    const current = phaseRef.current;
    if (state.phase === "matched" && state.peer) {
      setSessionId(state.sessionId ?? null);
      setMatch({
        id: state.peer.username,
        name: state.peer.name,
        username: state.peer.username,
        ...(state.peer.contactId ? { contactId: state.peer.contactId } : {}),
      });
      setMyVote(state.myVote ?? null);
      setTheirVote(state.theirVote ?? null);
      setUnlocked(state.mutual);
      if (state.theirVote === "down") {
        // The other side ended it: the pairing is over for both.
        setPhase("ended");
        return;
      }
      if (current === "idle" || current === "connecting") {
        setPhase("matched");
        timers.current.push(
          setTimeout(() => {
            if (phaseRef.current === "matched") setPhase("chat");
          }, 1400),
        );
      }
      return;
    }
    if (state.phase === "ended") {
      if (current === "chat" || current === "matched") setPhase("ended");
      return;
    }
    if (state.phase === "waiting") {
      if (current === "idle") setPhase("connecting");
      return;
    }
    // idle on the server: a pairing we were in has been removed.
    if (current === "chat" || current === "matched") setPhase("ended");
  }, []);

  // Resume an existing waiting place or pairing, and follow live changes from
  // the other side (their vote, their exit).
  useEffect(() => {
    let alive = true;
    void currentAccountId().then((id) => {
      if (alive && id) setAccountId(id);
    });
    void readConnectState().then((state) => {
      if (alive) applyState(state);
    });
    return () => {
      alive = false;
    };
  }, [applyState]);

  useEffect(() => {
    if (!accountId) return;
    return subscribeConnect(accountId, () => {
      void readConnectState().then(applyState);
    });
  }, [accountId, applyState]);

  // Temporary Connect chat text lives on the server, tied to this pairing: it
  // is loaded when the chat opens or resumes, and both matched users receive
  // new messages live. Nothing is kept on the device.
  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    const load = () => {
      void readConnectMessages(sessionId).then((list) => {
        if (alive) setMsgs(toBubbles(list));
      });
    };
    load();
    const stop = subscribeConnectMessages(sessionId, load);
    return () => {
      alive = false;
      stop();
    };
  }, [sessionId]);

  // While waiting, keep the place in the waiting room alive and ask again for a
  // partner; the server pairs the longest-waiting eligible stranger.
  useEffect(() => {
    if (phase !== "connecting") return;
    const tick = window.setInterval(() => {
      void requestConnectMatch().then((state) => {
        if (!state) {
          setPhase("unavailable");
          return;
        }
        applyState(state);
      });
    }, WAIT_POLL_MS);
    return () => window.clearInterval(tick);
  }, [phase, applyState]);

  const startConnect = async () => {
    // The server decides eligibility: verified account, finished profile,
    // Unique ID. Nothing is fabricated when matching is unavailable.
    const eligibility = await checkConnectEligibility();
    if (!eligibility.eligible) {
      if (eligibility.reason === "unavailable") setPhase("unavailable");
      else if (eligibility.reason === "profile-incomplete") notify("Finish your profile to use Connect");
      else if (eligibility.reason === "no-unique-id") notify("Your Unique ID is still being issued");
      else notify("Connect is not available for this account");
      return;
    }
    // One Find Credit per connection attempt, checked centrally.
    if (!(await spendCredit())) return;
    setPhase("connecting");
    const state = await requestConnectMatch();
    if (!state) {
      setPhase("unavailable");
      return;
    }
    applyState(state);
  };

  const cancelWaiting = async () => {
    await endConnect();
    reset();
  };

  const send = () => {
    const text = draft.trim();
    if (!text || !sessionId) return;
    setDraft("");
    const clientId = `me-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Shown at once, stored server-side; a rejected send (ended or blocked
    // pairing) is rolled back again.
    setMsgs((m) => [...m, { id: clientId, mine: true, text, time: now() }]);
    void sendConnectChatMessage(sessionId, clientId, text).then((saved) => {
      if (saved) {
        setMsgs((m) => m.map((b) => (b.id === clientId ? { ...b, id: saved.id } : b)));
        return;
      }
      setMsgs((m) => m.filter((b) => b.id !== clientId));
      notify("This connection no longer accepts messages");
    });
  };

  const thumbUp = () => {
    if (myVote || !sessionId) return;
    setMyVote("up");
    void voteOnConnect(sessionId, "up").then((state) => {
      if (state) applyState(state);
      else setMyVote(null);
    });
  };

  const endConnection = () => {
    setConfirmDown(false);
    setMyVote("down");
    setPhase("ended");
    void (async () => {
      if (sessionId) await voteOnConnect(sessionId, "down");
      await endConnect();
    })();
  };

  /* ---------------- Temporary Connect Chat ---------------- */

  if (phase === "chat" && match) {
    const bothLiked = myVote === "up" && theirVote === "up";
    return (
      <main className="min-h-screen bg-surface pb-[calc(74px+env(safe-area-inset-bottom))] pt-[max(14px,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
          <header className="flex items-center gap-2.5">
            <button
              type="button"
              aria-label="Back"
              onClick={() => setConfirmDown(true)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink active:scale-[0.98]"
            >
              <ChevronLeft size={19} strokeWidth={1.9} />
            </button>

            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-line bg-surface px-2 py-1.5">
              {unlocked ? (
                <Avatar name={match.name} seed={seedOf(match.username)} size={30} />
              ) : (
                <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-muted text-ink-2">
                  <UserRound size={16} strokeWidth={1.9} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">
                  {unlocked ? match.name : "Anonymous"}
                </span>
                <span className="block truncate text-[11px] text-ink-2">
                  {unlocked ? match.username : "Temporary connection"}
                </span>
              </span>
            </div>

            <button
              type="button"
              aria-label="Like"
              onClick={thumbUp}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border transition-colors ${
                myVote === "up"
                  ? "border-ink bg-ink text-background"
                  : "border-line bg-surface text-ink"
              }`}
            >
              <ThumbsUp size={17} strokeWidth={1.9} />
            </button>
            <button
              type="button"
              aria-label="Dislike"
              onClick={() => setConfirmDown(true)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink"
            >
              <ThumbsDown size={17} strokeWidth={1.9} />
            </button>
          </header>

          <div className="mt-4 space-y-2">
            {myVote === "up" && !bothLiked && (
              <p className="text-center text-[11.5px] text-ink-2">
                You liked this connection. Waiting for them…
              </p>
            )}

            {msgs.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.mine ? "justify-end" : "justify-start"}`}
                style={{ animation: "rise-in 220ms ease both" }}
              >
                <span
                  className={`max-w-[76%] rounded-xl px-3 py-2 text-[13.5px] leading-relaxed ${
                    m.mine
                      ? "rounded-br-[6px] bg-ink text-background"
                      : "rounded-bl-[6px] border border-line bg-surface text-ink"
                  }`}
                >
                  {m.text}
                  <span
                    className={`mt-0.5 block text-[10px] ${
                      m.mine ? "text-background/60" : "text-ink-3"
                    }`}
                  >
                    {m.time}
                  </span>
                </span>
              </div>
            ))}

            {bothLiked && (
              <div
                className="mt-4 rounded-xl border border-line bg-surface p-4 text-center"
                style={{ animation: "rise-in 280ms cubic-bezier(0.22,1,0.36,1) both" }}
              >
                <Avatar name={match.name} seed={seedOf(match.username)} size={54} className="mx-auto" />
                <p className="mt-2 text-[14px] font-semibold text-ink">
                  You both liked each other
                </p>
                <p className="mt-0.5 text-[12px] text-ink-2">
                  {match.name} · {match.username}{match.contactId ? ` · ${match.contactId}` : ""}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    navigate({
                      to: "/chat/$username",
                      params: { username: handleKey(match.username) },
                    })
                  }
                  className="mt-3 h-10 w-full rounded-full bg-ink text-[13.5px] font-semibold text-background active:scale-[0.98]"
                >
                  Move to normal chat
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 bg-surface pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto w-full max-w-[430px] px-4 py-2.5">
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message"
                className="h-9 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
              />
              <button
                type="button"
                aria-label="Send"
                onClick={send}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-background active:scale-[0.98]"
              >
                <Send size={16} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        </div>

        <GlassSheet
          open={confirmDown}
          title="End this connection?"
          onClose={() => setConfirmDown(false)}
          actions={[
            { label: "End connection", Icon: ThumbsDown, tone: "danger", onSelect: endConnection },
            { label: "Keep chatting" },
          ]}
        />
      </main>
    );
  }

  /* ---------------- Connect home / connecting / matched / ended ---------------- */

  const outOfCredits = creditsLeft < 1;

  return (
    <main className="min-h-screen pb-28 pt-[max(18px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Connect</h1>
            <p className="mt-1 text-[12px] text-ink-2">Meet one new person at a time.</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink shadow-soft">
            <Coins size={15} strokeWidth={1.9} />
            {creditsLeft} credits
          </span>
        </header>

        {phase === "idle" && (
          <div
            className="relative"
            style={{
              minHeight:
                "calc(100vh - 180px - env(safe-area-inset-top) - env(safe-area-inset-bottom))",
              animation: "rise-in 260ms cubic-bezier(0.22,1,0.36,1) both",
            }}
          >
            <div className="absolute inset-0 flex flex-col">
              <div className="mt-5 flex items-center gap-3">
                <Avatar name={me.name} seed={3} size={46} photo={me.photo} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {me.name || "Your profile"}
                  </span>
                  <span className="block truncate text-[13px] text-ink-2">
                    {me.username || "Username not set"}
                    {me.contactId ? ` · ${me.contactId}` : ""}
                  </span>
                </span>
              </div>

              <button
                type="button"
                onClick={outOfCredits ? () => showLimit("credits") : startConnect}
                className="mt-5 inline-flex h-10 items-center gap-2 self-start rounded-full bg-ink px-5 text-[13px] font-semibold text-background shadow-soft transition-transform active:scale-[0.98]"
              >
                <Users size={16} strokeWidth={1.9} />
                {outOfCredits ? "Credits unavailable" : "Connect · 1 credit"}
              </button>

              {outOfCredits && (
                <button
                  type="button"
                  onClick={() => showLimit("credits")}
                  className="mt-2.5 inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-ink shadow-soft"
                >
                  <Crown size={14} strokeWidth={1.9} />
                  Get {limits.credits === 15 ? 50 : limits.credits} credits with Premium
                </button>
              )}

              <p className="mt-2 text-[11px] text-ink-3">
                {creditsLeft} of {limits.credits} daily credits left
              </p>

              {!isPremium && <AdSlot index={2} />}

              <section className="mt-auto pb-1">
                <h2 className="mb-1 pl-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  Rules
                </h2>
                <ol className="list-decimal space-y-0.5 pl-4 text-[11px] leading-relaxed text-ink-2 marker:text-ink-3">
                  {rules.map((r) => (
                    <li key={r.title}>
                      <span className="font-medium text-ink">{r.title}</span>
                      {" — "}
                      {r.note}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          </div>
        )}

        {phase === "connecting" && (
          <section className="mt-24 text-center">
            <span className="relative mx-auto grid h-28 w-28 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/20" />
              <span className="absolute inset-3 animate-pulse rounded-full bg-brand/25" />
              <Avatar name={me.name} seed={3} size={64} className="relative" photo={me.photo} />
            </span>
            <p className="mt-6 text-[15px] font-semibold text-ink">Connecting…</p>
            <p className="mt-1 text-[12px] text-ink-2">Finding someone who's free right now</p>
            <button
              type="button"
              onClick={() => void cancelWaiting()}
              className="mt-6 inline-flex h-9 items-center rounded-full border border-line bg-surface px-4 text-[12px] font-semibold text-ink shadow-soft active:scale-[0.98]"
            >
              Cancel
            </button>
          </section>
        )}

        {phase === "matched" && match && (
          <section
            className="mt-24 text-center"
            style={{ animation: "rise-in 280ms cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-muted text-ink">
              <Sparkles size={26} strokeWidth={1.9} />
            </span>
            <p className="mt-5 text-[17px] font-semibold text-ink">It's a match</p>
            <p className="mt-1 text-[12.5px] text-ink-2">
              Someone is ready to talk
            </p>
            <p className="mt-6 text-[11.5px] text-ink-3">Opening temporary chat…</p>
          </section>
        )}

        {phase === "unavailable" && (
          <section className="mt-24 text-center" style={{ animation: "rise-in 260ms ease both" }}>
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-muted text-ink">
              <Users size={24} strokeWidth={1.9} />
            </span>
            <p className="mt-5 text-[16px] font-semibold text-ink">Nobody available right now</p>
            <p className="mt-1 text-[12.5px] text-ink-2">
              Connect will match you as soon as people are online.
            </p>
            <button
              type="button"
              onClick={() => setPhase("idle")}
              className="mt-6 h-11 w-full rounded-[23px] bg-ink text-[14px] font-semibold text-background active:scale-[0.98]"
            >
              Back to Connect
            </button>
          </section>
        )}

        {phase === "ended" && (
          <section className="mt-24 text-center" style={{ animation: "rise-in 260ms ease both" }}>
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-muted text-ink">
              <ThumbsDown size={24} strokeWidth={1.9} />
            </span>
            <p className="mt-5 text-[16px] font-semibold text-ink">Connection ended</p>
            <p className="mt-1 text-[12.5px] text-ink-2">
              The chat and their profile were removed.
            </p>
            <button
              type="button"
              onClick={() => {
                reset();
                notify(`${creditsLeft} credits left today`);
              }}
              className="mt-6 h-11 w-full rounded-[23px] bg-ink text-[14px] font-semibold text-background active:scale-[0.98]"
            >
              Back to Connect
            </button>
          </section>
        )}
      </Screen>

      <BottomNav />
    </main>
  );
}
