/**
 * Local application store for N Connect.
 *
 * Holds the runtime copy of the signed-in account — profile, chats, messages,
 * notifications, relationships and the Free/Premium counters. Nothing here is
 * authoritative: it is read from and written back to the account on the server,
 * and chat history comes from the stored message system. Screens talk to this
 * only. No data is ever fabricated.
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
import {
  limitInfo,
  limitsFor,
  EXTRA_CREDIT_MIN,
  PLAN_OPTIONS,
  type LimitInfo,
  type LimitKey,
  type Plan,
  type PlanId,
  type PlanLimits,
} from "./entitlements";
import {
  cancelSubscription,
  loadEntitlements,
  purchaseExtraCredits,
  purchasePlan,
  spendConnectCredits,
  subscribeEntitlements,
  type EntitlementSnapshot,
} from "@/lib/billing/billing-repository";
import type { SnapshotSource } from "./backup/device-snapshot";
import type {
  AppNotification,
  BlockedPerson,
  ChatMessage,
  ChatRow,
  ContactEntry,
  ContactRequest,
  MessageRequest,
  Person,
  Profile,
  StatusEntry,
  StatusVisibility,
  TrustState,
} from "@/data/types";
import { ensureMyContactId, isContactId } from "@/lib/identity/contact-id";
import {
  loadContactRequests,
  respondToRequestOnServer,
  sendRequestOnServer,
  subscribeContactRequests,
  withdrawRequestOnServer,
} from "@/lib/social/contact-requests";
import {
  blockPeerOnServer,
  currentAccountId,
  loadSocialGraph,
  saveConnectionOnServer,
  setTrustOnServer,
  subscribeSocialGraph,
  unblockPeerOnServer,
  type SocialGraph,
} from "@/lib/social/social-graph";
import {
  fetchStatuses,
  publishStatus,
  removeStatus,
  viewStatus,
} from "@/lib/status/status-repository";
import {
  fileReport,
  forgetDeviceSessionPointer,
  listDeviceSessions,
  loadAccountState,
  loadChatDrafts,
  loadMutedProfiles,
  removeChatState,
  revokeDeviceSession,
  revokeOtherDeviceSessions,
  saveChatState,
  saveMyProfile,
  saveSettings,
  setProfileMuted,
  subscribeSettings,
  type DeviceSession,
  type ReportEntry,
} from "@/lib/account/account-repository";
import { loadConversation } from "@/lib/events/message-history";

/** Statuses expire automatically 24 hours after they are posted. */
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The permanent Unique ID is issued by the database only. Anything on the
 * device that is not a well-formed server ID is dropped; the start-up sync
 * below asks the server for the real one.
 */
function withContactId(me: Profile): Profile {
  if (isContactId(me.contactId)) return me;
  const { contactId: _drop, ...rest } = me;
  return rest as Profile;
}

/** Drops expired entries, newest first. */
function liveStatuses(list: StatusEntry[] | undefined): StatusEntry[] {
  const cutoff = Date.now() - STATUS_TTL_MS;
  return (list ?? []).filter((e) => e.createdAt > cutoff).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Today's usage, derived from the server entitlement snapshot. Nothing about
 * plans, credits or daily usage is stored on the device any more.
 */


export type Counters = {
  dailyCreditsUsed: number;
  dailyImagesSent: number;
  completedCallsToday: number;
  callMinutesToday: number;
  lastResetDate: string;
};

export type AppSettings = {
  privateAccount: boolean;
  readReceipts: boolean;
  nearbyVisible: boolean;
  tagging: boolean;
  lastSeen: string;
  whoCanMessage: string;
  hideProfilePhoto: boolean;
  incognitoNearby: boolean;
  screenshotBlock: boolean;
  notifications: Record<string, boolean>;
  chat: Record<string, boolean>;
  defaultDisappearing: string;
  autoDownload: string;
  background: string;
  customBackgroundPath: string;
  textSize: string;
  bubble: string;
  reduceMotion: boolean;
  bubbleColour: string;
  chatFont: string;
  /**
   * Backup media is a plan-limited preference kept here so chats can honour it
   * offline. The backup schedule itself lives in the backend, not on the
   * device.
   */
  backupMedia: boolean;
  callQuality: string;
  lowData: boolean;
  loginAlerts: boolean;
};

/**
 * The runtime copy of the account. Nothing here is authoritative: the profile,
 * settings, chat list, mutes, reports and sessions are read from and written to
 * the account on the server, and chat history comes from the message system.
 */
type AppStateShape = {
  me: Profile;
  chats: ChatRow[];
  messages: Record<string, ChatMessage[]>;
  notifications: AppNotification[];
  requests: MessageRequest[];
  blocked: BlockedPerson[];
  relations: Record<string, "follow" | "following" | "requested">;
  liked: string[];
  followRequests: Person[];
  /** Device sessions as the account records them (display metadata only). */
  sessions: DeviceSession[];
  clearedCache: boolean;
  settings: AppSettings;
  /** True while the server recognises a session for this device. */
  signedIn: boolean;
  /** Phone number is the only authentication identifier. */
  authPhone: string | null;
  phoneVerified: boolean;
  registeredPhone: string | null;
  /** 24-hour statuses, expired entries pruned on read. */
  statuses: StatusEntry[];
  /** Ids of statuses already viewed (no blue ring). */
  seenStatus: string[];
  /** Profiles this account has muted. */
  mutedProfiles: string[];
  /** Reports this account has filed, as the account stores them. */
  reports: ReportEntry[];
};

/** An empty profile until the local account flow creates a real one. */
function blankProfile(): Profile {
  return {
    id: "me",
    name: "",
    username: "",
    bio: "",
    location: "",
    followers: 0,
    following: 0,
    likes: 0,
    private: false,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Usage counters as the server reports them; zeroes until a snapshot arrives. */
function countersFrom(snapshot: EntitlementSnapshot | null): Counters {
  return {
    dailyCreditsUsed: snapshot?.credits.dailyUsed ?? 0,
    dailyImagesSent: snapshot?.images.used ?? 0,
    completedCallsToday: snapshot?.calls.completedToday ?? 0,
    callMinutesToday: Math.round(((snapshot?.calls.secondsUsedToday ?? 0) / 60) * 10) / 10,
    lastResetDate: today(),
  };
}

function defaultSettings(): AppSettings {
  return {
    privateAccount: false,
    readReceipts: true,
    nearbyVisible: true,
    tagging: false,
    lastSeen: "Contacts",
    whoCanMessage: "Followers",
    hideProfilePhoto: false,
    incognitoNearby: false,
    screenshotBlock: false,
    notifications: {
      messages: true,
      groups: true,
      calls: true,
      requests: true,
      followers: true,
      likes: false,
      security: true,
      preview: true,
      vibrate: true,
      sound: true,
    },
    chat: { typing: true, enter: false, archiveKeep: true, saveMedia: false, spellcheck: true },
    defaultDisappearing: "Off",
    autoDownload: "Wi-Fi only",
    background: "Petals",
    customBackgroundPath: "",
    textSize: "Default",
    bubble: "Rounded",
    reduceMotion: false,
    bubbleColour: "Classic",
    chatFont: "SF Pro",
    backupMedia: false,
    callQuality: "Standard",
    lowData: false,
    loginAlerts: true,
  };
}

/** A fresh install: no seeded users, chats, notifications or relationships. */
function initialState(): AppStateShape {
  return {
    me: blankProfile(),
    chats: [],
    messages: {},
    notifications: [],
    requests: [],
    blocked: [],
    relations: {},
    liked: [],
    followRequests: [],
    sessions: [],
    clearedCache: false,
    settings: defaultSettings(),
    signedIn: false,
    authPhone: null,
    phoneVerified: false,
    registeredPhone: null,
    statuses: [],
    seenStatus: [],
    mutedProfiles: [],
    reports: [],
  };
}

export function key(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}


type Ctx = {
  ready: boolean;
  /** Plan as the server reports it; free until a snapshot says otherwise. */
  plan: Plan;
  isPremium: boolean;
  /** The raw server entitlement snapshot, or null when there is none to read. */
  entitlements: EntitlementSnapshot | null;
  /** True once the server has answered with this account's entitlement state. */
  entitlementsLoaded: boolean;
  /** Re-reads the server entitlement / credit snapshot. */
  refreshEntitlements: () => void;
  creditsPlanActive: boolean;
  verificationActive: boolean;
  verificationExpiresAt: number | null;
  /** Extra Connect Credits bought on top of the daily 70. */
  extraCredits: number;
  /** Of today's refresh only, ignoring extra credits. */
  dailyCreditsLeft: number;
  limits: PlanLimits;
  counters: Counters;
  creditsLeft: number;
  imagesLeft: number;
  callsLeft: number;
  callMinutesLeft: number;

  me: Profile;
  chats: ChatRow[];
  notifications: AppNotification[];
  requests: MessageRequest[];
  blocked: BlockedPerson[];
  mutedProfiles: string[];
  followRequests: Person[];
  sessions: AppStateShape["sessions"];
  settings: AppSettings;
  clearedCache: boolean;
  signedIn: boolean;
  authPhone: string | null;
  phoneVerified: boolean;
  registeredPhone: string | null;

  people: Person[];
  relationOf: (username: string) => "follow" | "following" | "requested";
  likedProfile: (username: string) => boolean;
  messagesFor: (username: string) => ChatMessage[];
  /** Replaces the in-memory copy of a conversation with the stored history. */
  loadHistory: (username: string) => Promise<void>;
  /** The unsent text saved for this conversation. */
  draftFor: (username: string) => string;
  /** Saves (or clears) the unsent text for this conversation. */
  saveDraft: (username: string, text: string) => void;
  chatFor: (username: string) => ChatRow | undefined;
  canMessage: (username: string) => boolean;

  /** Returns the blocking limit, or null when the action is allowed. */
  check: (k: LimitKey, amount?: number) => LimitInfo | null;
  /** Runs `check`; on failure opens the Premium sheet and returns false. */
  require: (k: LimitKey, amount?: number) => boolean;
  showLimit: (k: LimitKey) => void;
  limitSheet: LimitInfo | null;
  closeLimit: () => void;

  /** Spends one Connect Credit server-side (daily refresh first, extras after). */
  spendCredit: () => Promise<boolean>;
  /** Re-reads the server usage after images were sent. */
  countImages: (n: number) => void;
  /** Re-reads the server usage after a call finished. */
  recordCall: (minutes: number) => void;
  /** Starts a real checkout for one of the two plans (server-verified). */
  upgrade: (planId?: PlanId) => Promise<void>;
  /** Starts a real checkout for extra Connect Credits. */
  buyExtraCredits: (count: number) => Promise<boolean>;
  cancelPremium: () => Promise<void>;

  setMe: (patch: Partial<Profile>) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  patchChat: (id: string, patch: Partial<ChatRow>) => void;
  removeChat: (id: string) => void;
  openChat: (username: string) => void;
  appendMessage: (username: string, msg: ChatMessage) => void;
  /**
   * Stores a message that arrived from the backend for the local chat list.
   * Creates the chat row when this is the first message from that person and
   * ignores a message id that is already present (realtime + catch-up overlap).
   */
  receiveMessage: (from: { name: string; username: string }, msg: ChatMessage) => void;
  updateMessages: (username: string, fn: (list: ChatMessage[]) => ChatMessage[]) => void;
  startConversation: (person: Person, text: string) => boolean;
  resolveRequest: (id: string, accept: boolean) => void;
  setRelation: (username: string, next: "follow" | "following" | "requested") => void;
  toggleLike: (username: string) => void;
  resolveFollowRequest: (id: string, accept: boolean) => void;
  blockPerson: (p: { id: string; name: string; username: string; location?: string }) => void;
  unblock: (id: string) => void;
  isBlocked: (username: string) => boolean;
  /** True when this profile is muted (no notifications from them). */
  isMuted: (username: string) => boolean;
  /** Mutes or unmutes a profile and persists the choice. */
  toggleMuteProfile: (username: string) => boolean;
  /** Files a report against a profile and persists it. */
  reportUser: (username: string, reason: string) => void;
  markNotificationsRead: () => void;
  readNotification: (id: string) => void;
  resolveNotification: (id: string, accept: boolean) => void;
  pushNotification: (n: Omit<AppNotification, "id" | "time"> & Partial<Pick<AppNotification, "id" | "time">>) => void;
  endSession: (id: string) => void;
  endOtherSessions: () => void;
  clearCache: () => void;
  /** Removes every stored photo from all chats on this device. */
  deleteAllMedia: () => void;
  /** The real data this account holds on the server, for a backup. */
  readBackupSource: () => Promise<SnapshotSource>;
  /** Writes a restored result back into the app state. */
  applyRestoredSource: (next: SnapshotSource) => void;
  /** Signs in with a verified phone number (the only auth identifier). */
  signIn: (phone?: string) => void;
  /** Marks a verified phone as owning a local account, then signs in. */
  completeRegistration: (phone: string) => void;
  /**
   * Saves the entered profile, links the verified phone and signs in.
   * `contactId` carries the permanent Unique ID allocated by the database.
   */
  createAccount: (input: {
    profile: Partial<Profile>;
    phone: string;
    private: boolean;
    contactId?: string;
  }) => void;

  /** Live (under 24h) statuses the signed-in user is allowed to see. */
  statuses: StatusEntry[];
  /** The signed-in user's own live statuses. */
  myStatuses: StatusEntry[];
  seenStatus: string[];
  addStatus: (input: {
    text?: string;
    image?: string;
    video?: string;
    videoStart?: number;
    videoEnd?: number;
    caption?: string;
    captionX?: number;
    captionY?: number;
    textAlign?: "left" | "center" | "right";
    textY?: number;
    background?: string;
    visibility: StatusVisibility;
  }) => void;

  deleteStatus: (id: string) => void;
  markStatusSeen: (id: string) => void;

  /** Saved contacts: approved "contact" connections as the server reports them. */
  contacts: ContactEntry[];
  /** Pending contact requests, incoming and outgoing, as the server reports them. */
  contactRequests: ContactRequest[];
  /** Re-reads the server's pending Contact Requests. */
  refreshContactRequests: () => void;
  isContact: (username: string) => boolean;
  /** Saves a person straight into Contacts (server approval). Sends nothing to them. */
  saveContact: (person: {
    name: string;
    username: string;
    contactId?: string;
  }) => "saved" | "contact";
  /** Ring state for a person's DP: blue before viewing, gray after, none when no live status. */
  statusRing: (username: string) => "unseen" | "seen" | null;
  /** Sends a Contact Request. The person is never added straight to Contacts. */
  sendContactRequest: (person: {
    name: string;
    username: string;
    contactId?: string;
  }) => Promise<"sent" | "exists" | "contact" | "failed">;

  /**
   * Delete the request, accept chat only, or accept and save the contact. For
   * an outgoing request "delete" withdraws it.
   */
  resolveContactRequest: (id: string, action: "delete" | "chat" | "contact") => void;
  /** True when text chat is unlocked with this person. */
  chatUnlocked: (username: string) => boolean;
  /** True while a contact request with this person is still unanswered. */
  contactRequestPending: (username: string) => boolean;
  /** This user's own trust choice plus the other side's. */
  trustOf: (username: string) => TrustState;
  /** Records "Trust this User" for this side only. */
  trustUser: (username: string) => void;
  /** Removes this side's trust. */
  untrustUser: (username: string) => void;
  /** Images, voice and video calls: only after both sides trust each other. */
  mediaUnlocked: (username: string) => boolean;
  /** True once the server has answered with this account's block/trust graph. */
  graphLoaded: boolean;
  /** True while that first load is still in flight. */
  graphLoading: boolean;
  /** Re-reads the server graph (block, trust, approved connections). */
  refreshGraph: () => void;

  signOut: () => void;
  deleteAccount: () => void;

  toast: string;
  notify: (message: string) => void;
};

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppStateShape>(initialState);
  const [ready, setReady] = useState(false);
  // Per-chat drafts as the account holds them, keyed by handle.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [limitSheet, setLimitSheet] = useState<LimitInfo | null>(null);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Server-authoritative Contact Requests (both directions, pending only).
  const [requests, setRequests] = useState<ContactRequest[]>([]);
  // Outgoing requests that were pending the last time the server answered. When
  // one disappears and the next graph read shows chat unlocked, it was accepted.
  const outgoingPending = useRef<Map<string, { name: string; username: string }>>(new Map());
  const [answeredOutgoing, setAnsweredOutgoing] = useState<
    Array<{ name: string; username: string; seenGraph: number }>
  >([]);
  // Server-authoritative block / trust / approved-connection state.
  const [graph, setGraph] = useState<SocialGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  // Counts successful graph reads so answered requests wait for a fresh one.
  const [graphVersion, setGraphVersion] = useState(0);
  const graphVersionRef = useRef(0);
  // The signed-in account id, used to scope realtime subscriptions.
  const [accountId, setAccountId] = useState<string | null>(null);
  // Server-authoritative plan, Connect Credits and today's usage.
  const [entitlements, setEntitlements] = useState<EntitlementSnapshot | null>(null);
  const [entitlementsLoaded, setEntitlementsLoaded] = useState(false);

  const refreshGraph = useCallback(() => {
    void (async () => {
      setGraphLoading(true);
      try {
        const next = await loadSocialGraph();
        setGraph(next);
        if (next) {
          setAccountId(next.meId);
          graphVersionRef.current += 1;
          setGraphVersion(graphVersionRef.current);
        }
      } finally {
        setGraphLoading(false);
      }
    })();
  }, []);

  const refreshContactRequests = useCallback(() => {
    void (async () => {
      const next = await loadContactRequests();
      if (!next) return;
      const stillOutgoing = new Set(
        next.filter((r) => r.direction === "outgoing").map((r) => key(r.username)),
      );
      const seenGraph = graphVersionRef.current;
      const gone: Array<{ name: string; username: string; seenGraph: number }> = [];
      outgoingPending.current.forEach((person, k) => {
        if (!stillOutgoing.has(k)) gone.push({ ...person, seenGraph });
      });
      outgoingPending.current = new Map(
        next
          .filter((r) => r.direction === "outgoing")
          .map((r) => [key(r.username), { name: r.name, username: r.username }]),
      );
      if (gone.length) setAnsweredOutgoing((list) => [...list, ...gone]);
      setRequests(next);
    })();
  }, []);

  // Startup load: the graph and the pending requests are read once the app is
  // hydrated, then kept live by realtime so a block, trust change or answered
  // request from the other side lands immediately.
  useEffect(() => {
    if (!ready) return;
    refreshGraph();
    refreshContactRequests();
    void currentAccountId().then((id) => {
      if (id) setAccountId(id);
    });
  }, [ready, refreshGraph, refreshContactRequests]);

  useEffect(() => {
    if (!accountId) return;
    const stopGraph = subscribeSocialGraph(accountId, refreshGraph);
    const stopRequests = subscribeContactRequests(accountId, () => {
      refreshContactRequests();
      // An accepted request also writes an approval row; read both together.
      refreshGraph();
    });
    return () => {
      stopGraph();
      stopRequests();
    };
  }, [accountId, refreshGraph, refreshContactRequests]);

  // Hydrate after mount from the account itself. The profile, settings, chat
  // list, drafts, mutes, reports and device sessions all come from the server,
  // so a reinstall or a second device shows the same account. Being signed in is
  // decided by the session the server recognises, never by device storage.
  const hydrateAccount = useCallback(async () => {
    try {
      const account = await loadAccountState();
      if (!account) {
        setState((s) => ({ ...s, signedIn: false }));
        return;
      }
      const drafts = await loadChatDrafts();
      setState((s) => ({
        ...s,
        signedIn: true,
        me: withContactId({ ...s.me, ...(account.profile ?? {}) }),
        settings: { ...s.settings, ...account.settings },
        chats: account.chats,
        mutedProfiles: account.mutedProfiles,
        reports: account.reports,
        sessions: account.sessions,
      }));
      setDrafts(drafts);
    } catch (error) {
      console.error("account state could not be loaded", error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateAccount();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateAccount]);

  // Account-level settings changed on another device arrive here live, so both
  // devices show the same privacy, chat and appearance choices.
  useEffect(() => {
    if (!state.signedIn) return;
    const stop = subscribeSettings((next) => {
      setState((s) => ({ ...s, settings: { ...s.settings, ...next } }));
    });
    return stop;
  }, [state.signedIn]);

  // The permanent Unique ID comes from the database. A signed-in account with a
  // finished profile asks for it once per load; the server returns the same
  // value forever, so this is a sync and never an allocation.
  useEffect(() => {
    if (!ready || !state.signedIn || !state.me.username) return;
    let cancelled = false;
    void ensureMyContactId().then((serverId) => {
      if (cancelled || !serverId) return;
      setState((s) => (s.me.contactId === serverId ? s : { ...s, me: { ...s.me, contactId: serverId } }));
    });
    return () => {
      cancelled = true;
    };
  }, [ready, state.signedIn, state.me.username]);

  // When a request this account sent is accepted, the sender gets text chat too:
  // the server records the other side's approval, which unlocks chat here. Give
  // that conversation a row so it shows up in the chat list.
  useEffect(() => {
    if (!ready || answeredOutgoing.length === 0 || !graph) return;
    // Only judge a request against a graph read after it disappeared.
    const settled = answeredOutgoing.filter((p) => p.seenGraph < graphVersion);
    if (settled.length === 0) return;
    const accepted = settled.filter((p) => graph.chatAllowed.includes(key(p.username)));
    // A withdrawn or deleted request never unlocks anything; it is dropped.
    setAnsweredOutgoing((list) => list.filter((p) => p.seenGraph >= graphVersion));
    if (accepted.length === 0) return;
    setState((s) => {
      let next = s;
      accepted.forEach((p) => {
        const k = key(p.username);
        const hasChat = next.chats.some((c) => key(c.username) === k);
        next = {
          ...next,
          chats: hasChat
            ? next.chats.map((c) => (key(c.username) === k ? { ...c, accepted: true } : c))
            : [
                {
                  id: `c${Date.now()}${k}`,
                  name: p.name,
                  username: p.username,
                  message: "Contact request accepted",
                  time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
                  online: false,
                  lastSeen: "Last seen recently",
                  accepted: true,
                },
                ...next.chats,
              ],
        };
      });
      return next;
    });
  }, [ready, answeredOutgoing, graph, graphVersion]);

  // Nothing is written to device storage any more: the profile, settings, chat
  // list, drafts, mutes, reports and sessions are written to the account as they
  // change, and chat history stays in the server message system.

  // Statuses come from the backend, never from this device. The refresh runs on
  // load and after every change so expiry, views and deletions stay accurate.
  const refreshStatuses = useCallback(async () => {
    try {
      const { statuses, seen } = await fetchStatuses();
      setState((s) => ({ ...s, statuses, seenStatus: seen }));
    } catch (error) {
      console.error("statuses could not be loaded", error);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshStatuses();
    const timer = setInterval(() => void refreshStatuses(), 60_000);
    return () => clearInterval(timer);
  }, [ready, refreshStatuses]);

  // Plan, Connect Credits and today's usage are read from the server. Nothing
  // about them is stored on the device, so a refresh (or another device) always
  // shows the same answer the backend enforces.
  const refreshEntitlements = useCallback(() => {
    void (async () => {
      const snapshot = await loadEntitlements();
      setEntitlements(snapshot);
      setEntitlementsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    refreshEntitlements();
    // The daily refresh happens server-side; re-reading keeps a long-open app
    // (and a midnight rollover) accurate without any local counter.
    const timer = setInterval(refreshEntitlements, 60_000);
    return () => clearInterval(timer);
  }, [ready, refreshEntitlements]);

  // A verified payment or a credit movement lands here immediately.
  useEffect(() => {
    if (!graph?.meId) return;
    return subscribeEntitlements(graph.meId, refreshEntitlements);
  }, [graph?.meId, refreshEntitlements]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1800);
  }, []);

  // One shared Premium entitlement: the server reports it active while either
  // the ₹49 Connect Credits plan or the ₹99 Verification Badge is active.
  const creditsPlanActive = entitlements?.creditsPlanActive ?? false;
  const verificationActive = entitlements?.verificationActive ?? false;
  const verificationExpiresAt = entitlements?.verificationExpiresAt
    ? Date.parse(entitlements.verificationExpiresAt)
    : null;
  const plan: Plan = entitlements?.premium ? "premium" : "free";

  const limits = limitsFor(plan);
  const counters = countersFrom(entitlements);
  const extraCredits = entitlements?.credits.extraCredits ?? 0;
  // With no snapshot yet the plan's own allowance is shown; every spend still
  // has to be authorized by the server.
  const dailyCreditsLeft = entitlements?.credits.dailyLeft ?? limits.credits;
  const creditsLeft = entitlements ? entitlements.credits.creditsLeft : dailyCreditsLeft;
  const imagesLeft = entitlements?.images.left ?? limits.images;
  const callsLeft = entitlements
    ? (entitlements.calls.callsLeft ?? Number.POSITIVE_INFINITY)
    : Number.isFinite(limits.calls)
      ? limits.calls
      : Number.POSITIVE_INFINITY;
  const callMinutesLeft = entitlements
    ? entitlements.calls.secondsLeftToday === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.round((entitlements.calls.secondsLeftToday / 60) * 10) / 10)
    : Number.isFinite(limits.callMinutesPerDay)
      ? limits.callMinutesPerDay
      : Number.POSITIVE_INFINITY;

  const check = useCallback<Ctx["check"]>(
    (k, amount = 1) => {
      switch (k) {
        case "credits":
          return creditsLeft >= amount ? null : limitInfo("credits");
        case "images":
          return imagesLeft >= amount ? null : limitInfo("images");
        case "calls":
          return callsLeft >= amount ? null : limitInfo("calls");
        case "callMinutes":
          return callMinutesLeft > 0 ? null : limitInfo("callMinutes");
        case "disappearing60d":
          return limits.disappearing.includes("60 days") ? null : limitInfo("disappearing60d");
        case "backupMedia":
          return limits.backupMedia ? null : limitInfo("backupMedia");
        case "advancedPrivacy":
          return limits.advancedPrivacy ? null : limitInfo("advancedPrivacy");
        case "chatCustomization":
          return limits.chatCustomization ? null : limitInfo("chatCustomization");
        case "initiateMessage":
          return limits.initiateMessage ? null : limitInfo("initiateMessage");
        default:
          return null;
      }
    },
    [creditsLeft, imagesLeft, callsLeft, callMinutesLeft, limits],
  );

  const require = useCallback<Ctx["require"]>(
    (k, amount = 1) => {
      const blocked = check(k, amount);
      if (blocked) {
        setLimitSheet(blocked);
        return false;
      }
      return true;
    },
    [check],
  );

  const patch = useCallback((fn: (s: AppStateShape) => AppStateShape) => {
    setState((s) => fn(s));
  }, []);

  const value = useMemo<Ctx>(() => {
    // A blocked person is invisible everywhere: contacts, search, suggestions,
    // requests, previews and Unique ID / QR lookups. The server list is the
    // authority; the local list only carries the display row for the Blocked
    // screen and covers the moment before the server answers.
    const blockedKeys = new Set([
      ...state.blocked.map((b) => key(b.username)),
      ...(graph?.blocked ?? []),
    ]);
    const isBlockedKey = (username: string) => blockedKeys.has(key(username));
    // Contacts are the approved "contact" connections the server reports.
    const visibleContacts: ContactEntry[] = (graph?.contacts ?? [])
      .map((k) => {
        const person = graph?.people[k];
        return {
          id: `sc-${k}`,
          name: person?.name ?? k,
          username: person?.username ?? k,
          ...(person?.contactId ? { contactId: person.contactId } : {}),
          addedAt: 0,
        };
      })
      .filter((c) => !isBlockedKey(c.username));

    // Pending requests both ways, straight from the server so the recipient
    // sees what the sender sent and vice versa.
    const pendingRequests: ContactRequest[] = requests.filter((r) => !isBlockedKey(r.username));
    const pendingWith = (username: string) =>
      pendingRequests.find((r) => key(r.username) === key(username));

    // Text chat is unlocked by Accept Chat or Accept Contact — never by a
    // request that is still pending. The approved connection recorded by the
    // server unlocks it for both sides.
    const chatUnlockedFor = (username: string): boolean => {
      const k = key(username);
      if (isBlockedKey(k)) return false;
      return Boolean(graph?.chatAllowed.includes(k));
    };

    // Trust is one-sided per person and lives in the database: this side's own
    // choice and the other side's are two separate rows. Media and calls need
    // both, so an unanswered graph means locked, never assumed-open.
    const trustPair = (username: string): TrustState => {
      const k = key(username);
      if (!graph || isBlockedKey(k)) return { mine: false, theirs: false };
      return {
        mine: graph.trustMine.includes(k),
        theirs: graph.trustTheirs.includes(k),
      };
    };

    const relationOf = (username: string) => state.relations[key(username)] ?? "follow";
    const messagesFor = (username: string) => state.messages[key(username)] ?? [];
    const chatFor = (username: string) =>
      state.chats.find((c) => key(c.username) === key(username));
    const known = new Map<string, Person>();
    state.chats.forEach((c) => {
      const k = key(c.username);
      if (!known.has(k))
        known.set(k, {
          id: c.id,
          name: c.name,
          username: c.username,
          location: "",
          state: relationOf(c.username),
        });
    });
    state.requests.forEach((r) => {
      const k = key(r.username);
      if (!known.has(k))
        known.set(k, {
          id: r.id,
          name: r.name,
          username: r.username,
          location: r.location,
          state: relationOf(r.username),
        });
    });
    const localPeople = [...known.values()].filter((p) => !isBlockedKey(p.username));

    const live = liveStatuses(state.statuses);
    const myKey = key(state.me.username || "");
    const myStatuses = live.filter((e) => key(e.authorUsername) === myKey);
    // Public statuses follow account visibility; private ones only reach people
    // the user has approved (following relationship).
    const visibleStatuses = live.filter((e) => {
      if (key(e.authorUsername) === myKey) return false;
      if (isBlockedKey(e.authorUsername)) return false;
      // Rows that came from the backend already passed its visibility rules.
      if (e.serverAuthorized) return true;
      if (e.visibility === "public") return true;
      return relationOf(e.authorUsername) === "following";
    });

    // Blue ring before the current user views it, gray once viewed, and no ring
    // at all once every status of that person has expired.
    const statusRingFor = (username: string): "unseen" | "seen" | null => {
      const k = key(username);
      const mine = k === myKey;
      const list = (mine ? myStatuses : visibleStatuses).filter((e) => key(e.authorUsername) === k);
      if (list.length === 0) return null;
      return list.some((e) => !state.seenStatus.includes(e.id)) ? "unseen" : "seen";
    };

    return {
      ready,
      plan,
      isPremium: plan === "premium",
      entitlements,
      entitlementsLoaded,
      refreshEntitlements,
      creditsPlanActive,
      verificationActive,
      verificationExpiresAt,
      extraCredits,
      dailyCreditsLeft,
      limits,
      counters,
      creditsLeft,
      imagesLeft,
      callsLeft,
      callMinutesLeft,

      me: state.me,
      chats: state.chats,
      notifications: state.notifications,
      requests: state.requests,
      blocked: state.blocked,
      mutedProfiles: state.mutedProfiles,
      followRequests: state.followRequests,
      sessions: state.sessions,
      settings: state.settings,
      clearedCache: state.clearedCache,
      signedIn: state.signedIn,
      authPhone: state.authPhone,
      phoneVerified: state.phoneVerified,
      registeredPhone: state.registeredPhone,

      // Real local data only: people the account actually has chats or requests with.
      people: localPeople,
      relationOf,
      likedProfile: (u) => state.liked.includes(key(u)),
      messagesFor,
      chatFor,
      canMessage: (u) => {
        const chat = chatFor(u);
        if (chat) return chat.accepted !== false;
        return limits.initiateMessage;
      },

      check,
      require,
      showLimit: (k) => setLimitSheet(limitInfo(k)),
      limitSheet,
      closeLimit: () => setLimitSheet(null),

      // The server decides every spend: today's refresh is used first, then
      // purchased extras.
      spendCredit: async () => {
        const result = await spendConnectCredits(1);
        if (!result.ok) {
          setEntitlements((prev) =>
            prev && result.credits ? { ...prev, credits: result.credits } : prev,
          );
          setLimitSheet(limitInfo("credits"));
          return false;
        }
        setEntitlements((prev) =>
          prev && result.credits ? { ...prev, credits: result.credits } : prev,
        );
        refreshEntitlements();
        return true;
      },
      countImages: () => refreshEntitlements(),
      recordCall: () => refreshEntitlements(),
      // Purchases start a real payment. The plan only turns on once the payment
      // provider confirms it, so nothing is granted here.
      upgrade: async (planId = "credits") => {
        const checkout = await purchasePlan(planId);
        setLimitSheet(null);
        notify(
          checkout.ok
            ? `Complete the payment for ${PLAN_OPTIONS[planId].name}`
            : "Payments are not available right now",
        );
        refreshEntitlements();
      },
      buyExtraCredits: async (count) => {
        if (!Number.isFinite(count) || count < EXTRA_CREDIT_MIN) {
          notify(`Minimum ${EXTRA_CREDIT_MIN} extra credits`);
          return false;
        }
        const add = Math.round(count);
        const checkout = await purchaseExtraCredits(add);
        notify(
          checkout.ok
            ? `Complete the payment for ${add} Connect Credits`
            : "Payments are not available right now",
        );
        refreshEntitlements();
        return checkout.ok;
      },
      cancelPremium: async () => {
        const snapshot = await cancelSubscription();
        if (snapshot) setEntitlements(snapshot);
        else refreshEntitlements();
        notify("Plan cancelled");
      },

      // The profile lives in the database: the edit is written there and kept in
      // memory so the screen paints immediately.
      setMe: (p) =>
        patch((s) => {
          // The Contact ID is permanent: it can never be edited or regenerated.
          const { contactId: _ignored, ...safe } = p;
          void saveMyProfile(safe);
          return { ...s, me: { ...s.me, ...safe } };
        }),
      setSettings: (p) => {
        const settings = { ...state.settings, ...p };
        void saveSettings(settings);
        patch((s) => ({ ...s, settings: { ...s.settings, ...p } }));
      },
      patchChat: (id, p) => {
        const row = state.chats.find((c) => c.id === id);
        if (row) {
          void saveChatState(row.username, {
            ...(p.name !== undefined ? { name: p.name } : {}),
            ...(p.message !== undefined ? { preview: p.message } : {}),
            ...(p.time !== undefined ? { timeLabel: p.time } : {}),
            ...(p.unread !== undefined ? { unread: p.unread } : {}),
            ...(p.pinned !== undefined ? { pinned: p.pinned } : {}),
            ...(p.archived !== undefined ? { archived: p.archived } : {}),
            ...(p.muted !== undefined ? { muted: p.muted } : {}),
            ...(p.accepted !== undefined ? { accepted: p.accepted } : {}),
            ...(p.disappearing !== undefined ? { disappearing: Boolean(p.disappearing) } : {}),
          });
        }
        patch((s) => ({ ...s, chats: s.chats.map((c) => (c.id === id ? { ...c, ...p } : c)) }));
      },
      removeChat: (id) => {
        const gone = state.chats.find((c) => c.id === id);
        if (gone) void removeChatState(gone.username);
        patch((s) => {
          const messages = { ...s.messages };
          if (gone) delete messages[key(gone.username)];
          return { ...s, chats: s.chats.filter((c) => c.id !== id), messages };
        });
      },
      openChat: (username) => {
        void saveChatState(username, { unread: 0, readNow: true });
        patch((s) => ({
          ...s,
          chats: s.chats.map((c) => (key(c.username) === key(username) ? { ...c, unread: 0 } : c)),
        }));
      },
      appendMessage: (username, msg) => {
        const preview = msg.images?.length
          ? `Sent ${msg.images.length} ${msg.images.length === 1 ? "photo" : "photos"}`
          : (msg.text ?? "");
        void saveChatState(username, {
          preview,
          timeLabel: msg.time,
          lastMessageAt: new Date().toISOString(),
        });
        patch((s) => {
          const k = key(username);
          const list = [...(s.messages[k] ?? []), msg];
          return {
            ...s,
            messages: { ...s.messages, [k]: list },
            chats: s.chats.map((c) =>
              key(c.username) === k ? { ...c, message: preview, time: msg.time } : c,
            ),
          };
        });
      },
      receiveMessage: (from, msg) => {
        const k = key(from.username);
        if ((state.messages[k] ?? []).some((m) => m.id === msg.id)) return;
        const preview = msg.images?.length
          ? `Sent ${msg.images.length} ${msg.images.length === 1 ? "photo" : "photos"}`
          : (msg.text ?? "");
        const unread = (state.chats.find((c) => key(c.username) === k)?.unread ?? 0) + 1;
        void saveChatState(from.username, {
          name: from.name,
          preview,
          timeLabel: msg.time,
          lastMessageAt: new Date().toISOString(),
          unread,
          accepted: true,
        });
        patch((s) => {
          const existing = s.messages[k] ?? [];
          if (existing.some((m) => m.id === msg.id)) return s;
          const has = s.chats.some((c) => key(c.username) === k);
          const chats = has
            ? s.chats.map((c) =>
                key(c.username) === k
                  ? { ...c, message: preview, time: msg.time, unread: (c.unread ?? 0) + 1 }
                  : c,
              )
            : [
                {
                  id: `c${Date.now()}`,
                  name: from.name,
                  username: from.username,
                  message: preview,
                  time: msg.time,
                  online: false,
                  lastSeen: "Last seen recently",
                  unread: 1,
                  accepted: true,
                } satisfies ChatRow,
                ...s.chats,
              ];
          return { ...s, messages: { ...s.messages, [k]: [...existing, msg] }, chats };
        });
      },
      updateMessages: (username, fn) =>
        patch((s) => {
          const k = key(username);
          return { ...s, messages: { ...s.messages, [k]: fn(s.messages[k] ?? []) } };
        }),
      // The stored conversation is the authority; this replaces the in-memory
      // copy with what the server holds.
      loadHistory: async (username) => {
        const history = await loadConversation(username);
        if (!history) return;
        patch((s) => ({ ...s, messages: { ...s.messages, [key(username)]: history } }));
      },
      draftFor: (username) => drafts[key(username)] ?? "",
      saveDraft: (username, text) => {
        const k = key(username);
        setDrafts((d) => ({ ...d, [k]: text }));
        void saveChatState(username, { draft: text });
      },
      startConversation: (person, text) => {
        const blockedBy = check("initiateMessage");
        if (blockedBy) {
          setLimitSheet(blockedBy);
          return false;
        }
        const k = key(person.username);
        const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        void saveChatState(person.username, {
          name: person.name,
          preview: text,
          timeLabel: time,
          lastMessageAt: new Date().toISOString(),
          accepted: false,
        });
        patch((s) => {
          const exists = s.chats.some((c) => key(c.username) === k);
          const row: ChatRow = {
            id: `c${Date.now()}`,
            name: person.name,
            username: person.username,
            message: text,
            time,
            online: false,
            lastSeen: "Waiting for them to accept",
            accepted: false,
          };
          return {
            ...s,
            chats: exists ? s.chats : [row, ...s.chats],
            messages: {
              ...s.messages,
              [k]: [
                ...(s.messages[k] ?? []),
                { id: `x${Date.now()}`, mine: true, text, time, state: "sent" as const },
              ],
            },
            requests: s.requests.some((r) => key(r.username) === k)
              ? s.requests
              : [
                  {
                    id: `r${Date.now()}`,
                    name: person.name,
                    username: person.username,
                    location: person.location,
                    preview: text,
                    time: "Just now",
                    direction: "outgoing" as const,
                  },
                  ...s.requests,
                ],
          };
        });
        notify("Message request sent");
        return true;
      },
      resolveRequest: (id, accept) => {
        const accepted = state.requests.find((r) => r.id === id);
        if (accept && accepted) {
          void saveChatState(accepted.username, {
            name: accepted.name,
            preview: accepted.preview,
            timeLabel: accepted.time,
            lastMessageAt: new Date().toISOString(),
            unread: 1,
            accepted: true,
          });
        }
        patch((s) => {
          const req = s.requests.find((r) => r.id === id);
          if (!req) return s;
          const k = key(req.username);
          const rest = s.requests.filter((r) => r.id !== id);
          if (!accept) return { ...s, requests: rest };
          const exists = s.chats.some((c) => key(c.username) === k);
          const row: ChatRow = {
            id: `c${Date.now()}`,
            name: req.name,
            username: req.username,
            message: req.preview,
            time: req.time,
            online: false,
            lastSeen: "Last seen recently",
            unread: 1,
            accepted: true,
          };
          return {
            ...s,
            requests: rest,
            chats: exists
              ? s.chats.map((c) => (key(c.username) === k ? { ...c, accepted: true } : c))
              : [row, ...s.chats],
            messages: {
              ...s.messages,
              [k]: s.messages[k]?.length
                ? s.messages[k]
                : [{ id: `x${Date.now()}`, mine: false, text: req.preview, time: req.time }],
            },
          };
        });
      },
      setRelation: (username, next) =>
        patch((s) => ({ ...s, relations: { ...s.relations, [key(username)]: next } })),
      toggleLike: (username) =>
        patch((s) => {
          const k = key(username);
          const on = s.liked.includes(k);
          return { ...s, liked: on ? s.liked.filter((x) => x !== k) : [...s.liked, k] };
        }),
      resolveFollowRequest: (id, accept) =>
        patch((s) => ({
          ...s,
          followRequests: s.followRequests.filter((p) => p.id !== id),
          me: accept ? { ...s.me, followers: s.me.followers + 1 } : s.me,
        })),
      // Blocking is decided by the server: it also drops every approval and
      // trust in both directions. The local row is only the Blocked-list entry.
      blockPerson: (p) => {
        patch((s) =>
          s.blocked.some((b) => key(b.username) === key(p.username))
            ? s
            : {
                ...s,
                blocked: [
                  {
                    id: p.id,
                    name: p.name,
                    username: p.username,
                    location: p.location ?? "",
                    state: "follow" as const,
                    since: `Blocked ${new Date().toLocaleDateString([], { day: "numeric", month: "short" })}`,
                  },
                  ...s.blocked,
                ],
              },
        );
        void (async () => {
          const outcome = await blockPeerOnServer(p.username);
          if (!outcome.ok && outcome.reason !== "unknown-user") {
            notify("Block could not be saved");
          }
          refreshGraph();
        })();
      },
      unblock: (id) => {
        const row = state.blocked.find((b) => b.id === id);
        patch((s) => ({ ...s, blocked: s.blocked.filter((b) => b.id !== id) }));
        if (!row) return;
        void (async () => {
          const outcome = await unblockPeerOnServer(row.username);
          if (!outcome.ok && outcome.reason !== "unknown-user") {
            notify("Unblock could not be saved");
          }
          refreshGraph();
        })();
      },
      isBlocked: (u) => isBlockedKey(u),
      isMuted: (u) => state.mutedProfiles.includes(key(u)),
      // The mute list belongs to the account: the choice is written to the
      // server and the local list is only the copy this screen renders.
      toggleMuteProfile: (u) => {
        const k = key(u);
        const next = !state.mutedProfiles.includes(k);
        patch((s) => ({
          ...s,
          mutedProfiles: next
            ? [...s.mutedProfiles, k]
            : s.mutedProfiles.filter((m) => m !== k),
        }));
        void (async () => {
          await setProfileMuted(k, next);
          const mutedProfiles = await loadMutedProfiles();
          setState((s) => ({ ...s, mutedProfiles }));
        })();
        return next;
      },
      // Reports are filed against the account, so support sees them no matter
      // which device they were sent from.
      reportUser: (u, reason) => {
        void (async () => {
          const filed = await fileReport(u, reason);
          if (filed) {
            setState((s) =>
              s.reports.some((r) => r.id === filed.id)
                ? s
                : { ...s, reports: [filed, ...s.reports] },
            );
            return;
          }
          notify("Report could not be sent");
        })();
      },
      markNotificationsRead: () =>
        patch((s) => ({
          ...s,
          notifications: s.notifications.map((n) => ({ ...n, unread: false })),
        })),
      readNotification: (id) =>
        patch((s) => ({
          ...s,
          notifications: s.notifications.map((n) => (n.id === id ? { ...n, unread: false } : n)),
        })),
      resolveNotification: (id, accept) =>
        patch((s) => ({
          ...s,
          notifications: s.notifications.map((n) =>
            n.id === id
              ? {
                  ...n,
                  unread: false,
                  type: accept ? "accepted" : "follower",
                  tone: accept ? "success" : "default",
                  text: accept ? "You accepted the request" : "Request rejected",
                }
              : n,
          ),
          me: accept ? { ...s.me, followers: s.me.followers + 1 } : s.me,
        })),
      pushNotification: (n) =>
        patch((s) => {
          // Backend notifications carry their own id; never store one twice.
          const id = n.id ?? `n${Date.now()}`;
          if (s.notifications.some((x) => x.id === id)) return s;
          return {
            ...s,
            notifications: [
              { ...n, id, time: n.time ?? "Just now", unread: n.unread ?? true },
              ...s.notifications,
            ],
          };
        }),
      // Sessions are real records: ending one revokes it for the account, not
      // just for this device's view.
      endSession: (id) => {
        patch((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id) }));
        void (async () => {
          const wasThisDevice = await revokeDeviceSession(id);
          if (wasThisDevice) forgetDeviceSessionPointer();
          const sessions = await listDeviceSessions();
          setState((s) => ({ ...s, sessions }));
        })();
      },
      endOtherSessions: () => {
        patch((s) => ({ ...s, sessions: s.sessions.filter((x) => x.current) }));
        void (async () => {
          await revokeOtherDeviceSessions();
          const sessions = await listDeviceSessions();
          setState((s) => ({ ...s, sessions }));
        })();
      },
      clearCache: () => {
        patch((s) => ({ ...s, clearedCache: true }));
        notify("Cache cleared");
      },
      deleteAllMedia: () => {
        // Strips every stored photo from every chat; the text messages stay.
        let removed = 0;
        patch((s) => {
          const messages: typeof s.messages = {};
          for (const [id, list] of Object.entries(s.messages)) {
            messages[id] = list.map((m) => {
              if (!m.images?.length) return m;
              removed += m.images.length;
              const { images: _drop, ...rest } = m;
              return { ...rest, text: m.text ?? "Photo deleted" };
            });
          }
          return { ...s, messages, statuses: s.statuses, clearedCache: true };
        });
        notify(removed ? `${removed} media file${removed === 1 ? "" : "s"} deleted` : "No media to delete");
      },
      // Backup reads this account's server-backed state: the stored profile,
      // settings, chat list and mutes, plus the stored conversations from the
      // message system. Nothing is read from device storage.
      readBackupSource: async () => {
        const account = await loadAccountState();
        const chats = account?.chats.length ? account.chats : state.chats;
        const messages: Record<string, ChatMessage[]> = {};
        for (const chat of chats) {
          const k = key(chat.username);
          const history = await loadConversation(chat.username);
          messages[k] = history ?? state.messages[k] ?? [];
        }
        return {
          me: withContactId({ ...state.me, ...(account?.profile ?? {}) }),
          chats,
          messages,
          notifications: state.notifications,
          // Contacts and requests are server rows; the archive carries the
          // current server view for completeness only.
          contacts: visibleContacts,
          contactRequests: pendingRequests,
          blocked: state.blocked,
          relations: state.relations,
          liked: state.liked,
          statuses: liveStatuses(state.statuses),
          seenStatus: state.seenStatus,
          mutedProfiles: account?.mutedProfiles ?? state.mutedProfiles,
          settings: { ...state.settings, ...(account?.settings ?? {}) },
        };
      },
      // Restore never touches authentication, permission or trust state: those
      // fields are simply not part of what a restore writes back. Contacts and
      // Contact Requests are server-authoritative and are re-read, not restored.
      applyRestoredSource: (next) => {
        patch((s) => ({
          ...s,
          me: withContactId(next.me),
          chats: next.chats,
          messages: next.messages,
          notifications: next.notifications,
          blocked: next.blocked,
          relations: next.relations,
          liked: next.liked,
          statuses: liveStatuses(next.statuses),
          seenStatus: next.seenStatus,
          mutedProfiles: next.mutedProfiles,
          settings: { ...s.settings, ...next.settings },
        }));
        // A restore is written back to the account, so the restored profile,
        // settings, chat list and mutes survive this device.
        void (async () => {
          const settings = { ...state.settings, ...next.settings };
          await saveMyProfile(next.me);
          await saveSettings(settings);
          for (const chat of next.chats) {
            await saveChatState(chat.username, {
              name: chat.name,
              preview: chat.message,
              timeLabel: chat.time,
              unread: chat.unread ?? 0,
              pinned: Boolean(chat.pinned),
              archived: Boolean(chat.archived),
              muted: Boolean(chat.muted),
              accepted: chat.accepted !== false,
              disappearing: Boolean(chat.disappearing),
            });
          }
          for (const username of next.mutedProfiles) await setProfileMuted(username, true);
          const account = await loadAccountState();
          if (account) {
            setState((s) => ({
              ...s,
              chats: account.chats,
              mutedProfiles: account.mutedProfiles,
              sessions: account.sessions,
            }));
          }
        })();
        refreshGraph();
        refreshContactRequests();
      },
      signIn: (phone) =>
        patch((s) => ({
          ...s,
          signedIn: true,
          authPhone: phone ?? s.authPhone,
          phoneVerified: phone ? true : s.phoneVerified,
        })),
      completeRegistration: (phone) =>
        patch((s) => ({
          ...s,
          signedIn: true,
          authPhone: phone,
          phoneVerified: true,
          registeredPhone: phone,
        })),
      statuses: visibleStatuses,
      myStatuses,
      seenStatus: state.seenStatus,
      // Posting goes straight to the backend: the media is uploaded to private
      // storage and the row carries the Public/Private choice and the 24-hour
      // expiry. Nothing is written to this device.
      addStatus: (input) => {
        void (async () => {
          try {
            const posted = await publishStatus(input);
            if (!posted) {
              notify("Sign in to post a status");
              return;
            }
            await refreshStatuses();
          } catch (error) {
            console.error("status not posted", error);
            notify("Status could not be posted");
          }
        })();
      },

      deleteStatus: (id) => {
        // Optimistic removal keeps the viewer responsive; the backend deletes
        // the row and its media.
        patch((s) => ({ ...s, statuses: s.statuses.filter((e) => e.id !== id) }));
        void (async () => {
          try {
            await removeStatus(id);
          } catch (error) {
            console.error("status not deleted", error);
          }
          await refreshStatuses();
        })();
      },
      markStatusSeen: (id) => {
        if (state.seenStatus.includes(id)) return;
        patch((s) => ({
          ...s,
          seenStatus: s.seenStatus.includes(id) ? s.seenStatus : [...s.seenStatus, id],
        }));
        // The backend records the view and decides whether it counts as a
        // private (approved contact) or public view.
        void (async () => {
          try {
            await viewStatus(id);
          } catch (error) {
            console.error("status view not recorded", error);
          }
          await refreshStatuses();
        })();
      },

      contacts: visibleContacts,
      contactRequests: pendingRequests,
      refreshContactRequests,
      isContact: (u) => Boolean(graph?.contacts.includes(key(u))),
      statusRing: (u) => statusRingFor(u),
      // Saving a contact records an approved connection on the server, so the
      // relationship survives this device and both sides agree on it.
      saveContact: (person) => {
        const k = key(person.username);
        if (graph?.contacts.includes(k)) return "contact";
        if (isBlockedKey(k)) {
          notify("This person is blocked");
          return "contact";
        }
        void (async () => {
          const outcome = await saveConnectionOnServer(person.username, "contact");
          if (!outcome.ok) {
            notify(outcome.reason === "blocked" ? "This person is blocked" : "Contact not saved");
          }
          refreshGraph();
        })();
        return "saved";
      },

      // The request is a server row: the recipient answers it on any device and
      // realtime brings the answer back here.
      sendContactRequest: async (person) => {
        const k = key(person.username);
        if (graph?.contacts.includes(k)) return "contact";
        if (isBlockedKey(k)) return "failed";
        if (pendingWith(k)) return "exists";
        const outcome = await sendRequestOnServer(person.username);
        if (outcome.ok) {
          notify("Contact request sent");
          refreshContactRequests();
          return "sent";
        }
        if (outcome.reason === "exists" || outcome.reason === "pending") return "exists";
        if (outcome.reason === "contact" || outcome.reason === "connected") return "contact";
        notify(outcome.reason === "blocked" ? "This person is blocked" : "Request not sent");
        return "failed";
      },
      resolveContactRequest: (id, action) => {
        const req = pendingRequests.find((r) => r.id === id);
        if (!req) return;
        // Optimistic removal; the server list replaces it on the next read.
        setRequests((list) => list.filter((r) => r.id !== id));
        void (async () => {
          const outcome =
            req.direction === "outgoing"
              ? await withdrawRequestOnServer(id)
              : await respondToRequestOnServer(id, action);
          if (!outcome.ok) {
            notify(
              action === "delete" && req.direction === "outgoing"
                ? "Request not withdrawn"
                : "Request not answered",
            );
          } else if (action !== "delete" && req.direction === "incoming") {
            const k = key(req.username);
            const time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
            // Accept Chat and Accept Contact both open the chat row; the row is
            // written to the account so every device shows the conversation.
            await saveChatState(req.username, {
              name: req.name,
              preview: "Contact request accepted",
              timeLabel: time,
              lastMessageAt: new Date().toISOString(),
              accepted: true,
            });
            patch((s) => {
              const exists = s.chats.some((c) => key(c.username) === k);
              const row: ChatRow = {
                id: `c${Date.now()}`,
                name: req.name,
                username: req.username,
                message: "Contact request accepted",
                time,
                online: false,
                lastSeen: "Last seen recently",
                accepted: true,
              };
              return {
                ...s,
                chats: exists
                  ? s.chats.map((c) => (key(c.username) === k ? { ...c, accepted: true } : c))
                  : [row, ...s.chats],
              };
            });
          }
          refreshContactRequests();
          refreshGraph();
        })();
      },
      chatUnlocked: (u) => chatUnlockedFor(u),
      contactRequestPending: (u) => Boolean(pendingWith(u)),
      trustOf: (u) => trustPair(u),
      // Trust is written to the database. The switch flips at once for feedback,
      // then the server's answer replaces it — a refused choice snaps back.
      trustUser: (u) => {
        const k = key(u);
        setGraph((g) =>
          g && !g.trustMine.includes(k) ? { ...g, trustMine: [...g.trustMine, k] } : g,
        );
        void (async () => {
          const outcome = await setTrustOnServer(u, true);
          if (!outcome.ok) {
            notify(outcome.reason === "blocked" ? "This person is blocked" : "Trust not saved");
          }
          refreshGraph();
        })();
      },
      untrustUser: (u) => {
        const k = key(u);
        // Revoking one side re-locks images, voice and video for both.
        setGraph((g) => (g ? { ...g, trustMine: g.trustMine.filter((x) => x !== k) } : g));
        void (async () => {
          const outcome = await setTrustOnServer(u, false);
          if (!outcome.ok) notify("Trust not saved");
          refreshGraph();
        })();
      },
      mediaUnlocked: (u) => {
        const t = trustPair(u);
        return t.mine && t.theirs;
      },
      graphLoaded: graph !== null,
      graphLoading,
      refreshGraph,

      // The profile itself is created on the server by the sign-up flow. This
      // only mirrors the result so the next screen paints at once, saves the
      // account-visibility choice, and then re-reads the account so the stored
      // values (and this device's session) are what the app shows.
      createAccount: ({ profile, phone, private: isPrivate, contactId: serverId }) => {
        const settings = { ...state.settings, privateAccount: isPrivate };
        patch((s) => {
          // One permanent Unique ID per account, issued by the database only.
          // Without a server value the start-up sync fetches it after sign-in.
          const contactId = isContactId(serverId)
            ? serverId
            : isContactId(s.me.contactId)
              ? s.me.contactId
              : undefined;
          const { contactId: _drop, ...me } = { ...s.me, ...profile };
          return {
            ...s,
            me: { ...me, ...(contactId ? { contactId } : {}), phone, private: isPrivate },
            settings,
            signedIn: true,
            authPhone: phone,
            phoneVerified: true,
            registeredPhone: phone,
          };
        });
        void (async () => {
          await saveSettings(settings);
          await hydrateAccount();
        })();
        refreshGraph();
        refreshContactRequests();
      },

      // Account state belongs to the signed-in account and lives on the server.
      // Signing out drops this device's copy and its session pointer, so the
      // next account never inherits anything from the previous one.
      signOut: () => {
        setGraph(null);
        forgetDeviceSessionPointer();
        setDrafts({});
        setState(initialState());
      },
      deleteAccount: () => {
        forgetDeviceSessionPointer();
        setDrafts({});
        setState(initialState());
        setGraph(null);
      },

      toast,
      notify,
    };
    // Everything the screens read is derived from the server-backed account
    // state above, the server graph, the server entitlements and the drafts the
    // account holds — so those are exactly what this value depends on.
  }, [
    state,
    drafts,
    hydrateAccount,
    requests,
    graph,
    graphLoading,
    refreshGraph,
    refreshContactRequests,
    refreshStatuses,
    entitlements,
    entitlementsLoaded,
    refreshEntitlements,
    ready,
    limits,
    counters,
    plan,
    creditsPlanActive,
    verificationActive,
    verificationExpiresAt,
    extraCredits,
    dailyCreditsLeft,
    creditsLeft,
    imagesLeft,
    callsLeft,
    callMinutesLeft,
    check,
    require,
    limitSheet,
    patch,
    notify,
    toast,
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
