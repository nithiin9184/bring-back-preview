/**
 * Central Free / Premium entitlement definitions.
 *
 * Every restricted action in the app resolves through this module, never
 * through hardcoded checks inside a screen. Swap the source of `plan` for a
 * real subscription record later and nothing else has to change.
 */

export type Plan = "free" | "premium";

export type PlanLimits = {
  /** Daily Credits available per day */
  credits: number;
  /** Images that may be sent per day */
  images: number;
  /** Completed voice calls per day */
  calls: number;
  /** Maximum length of one call, in minutes */
  callDurationMinutes: number;
  /** Maximum total call time per day, in minutes */
  callMinutesPerDay: number;
  /** Selectable disappearing-message timers */
  disappearing: string[];
  /** Backup can include photos and voice notes */
  backupMedia: boolean;
  /** Advanced privacy controls unlocked */
  advancedPrivacy: boolean;
  /** Premium chat customization unlocked */
  chatCustomization: boolean;
  /** Can start a brand new conversation / message request */
  initiateMessage: boolean;
  /** Small in-app ads are shown */
  ads: boolean;
  /** Premium badge on the profile */
  badge: boolean;
  /** Suggestion boost in People You May Know */
  boost: boolean;
};

export const PLANS: Record<Plan, PlanLimits> = {
  free: {
    credits: 15,
    images: 5,
    calls: 2,
    callDurationMinutes: 5,
    callMinutesPerDay: 10,
    disappearing: ["Off", "24 hours", "7 days"],
    backupMedia: false,
    advancedPrivacy: false,
    chatCustomization: false,
    initiateMessage: false,
    ads: true,
    badge: false,
    boost: false,
  },
  premium: {
    credits: 70,
    images: 20,
    calls: Number.POSITIVE_INFINITY,
    callDurationMinutes: Number.POSITIVE_INFINITY,
    callMinutesPerDay: Number.POSITIVE_INFINITY,
    disappearing: ["Off", "24 hours", "7 days", "60 days"],
    backupMedia: true,
    advancedPrivacy: true,
    chatCustomization: true,
    initiateMessage: true,
    ads: false,
    badge: true,
    boost: true,
  },
};

/** The two purchasable plans. Either one grants the same Premium entitlement. */
export type PlanId = "credits" | "verification";

export type PlanOption = {
  id: PlanId;
  name: string;
  price: string;
  amount: number;
  note: string;
};

export const PLAN_OPTIONS: Record<PlanId, PlanOption> = {
  credits: {
    id: "credits",
    name: "Connect Credits",
    price: "₹49",
    amount: 49,
    note: "70 Connect Credits every day",
  },
  verification: {
    id: "verification",
    name: "Verification Badge",
    price: "₹99",
    amount: 99,
    note: "Verification badge for 2 months",
  },
};

export const PLAN_LIST: PlanOption[] = [PLAN_OPTIONS.credits, PLAN_OPTIONS.verification];

/** Connect Credits refresh to exactly this number every day. */
export const DAILY_CONNECT_CREDITS = 70;

/** Extra credits bought on top of the daily refresh. */
export const EXTRA_CREDIT_PRICE = 2;
export const EXTRA_CREDIT_MIN = 20;

/** Verification badge validity, 2 months. */
export const VERIFICATION_DAYS = 60;
export const VERIFICATION_MS = VERIFICATION_DAYS * 24 * 60 * 60 * 1000;

/** Every gated capability in the product. */
export type LimitKey =
  | "credits"
  | "images"
  | "calls"
  | "callMinutes"
  | "disappearing60d"
  | "backupMedia"
  | "advancedPrivacy"
  | "chatCustomization"
  | "initiateMessage";

/** Description shown by the limit sheet when something is blocked. */
export type LimitInfo = {
  key: LimitKey;
  /** What limit was reached */
  title: string;
  /** The current Free limit, in plain words */
  freeLimit: string;
  /** What Premium gives instead */
  premiumBenefit: string;
};

export const LIMIT_COPY: Record<LimitKey, Omit<LimitInfo, "key">> = {
  credits: {
    title: "You've used today's Daily Credits",
    freeLimit: "Free includes 15 credits every day",
    premiumBenefit: "Connect Credits gives you 70 credits every day",
  },
  images: {
    title: "Daily image limit reached",
    freeLimit: "Free can send 5 images a day",
    premiumBenefit: "Premium can send 20 images a day",
  },
  calls: {
    title: "Daily voice call limit reached",
    freeLimit: "Free includes 2 completed calls a day",
    premiumBenefit: "Premium has unlimited voice calls",
  },
  callMinutes: {
    title: "Daily call time used up",
    freeLimit: "Free includes 10 minutes a day, 5 minutes per call",
    premiumBenefit: "Premium has no call-length or daily limits",
  },
  disappearing60d: {
    title: "60 day timer is a Premium option",
    freeLimit: "Free can choose 24 hours or 7 days",
    premiumBenefit: "Premium adds the 60 day disappearing timer",
  },
  backupMedia: {
    title: "Photo backup is Premium",
    freeLimit: "Free backs up your chats only",
    premiumBenefit: "Premium backs up chats plus photos and voice notes",
  },
  advancedPrivacy: {
    title: "Advanced Privacy is Premium",
    freeLimit: "Free has the standard privacy controls",
    premiumBenefit: "Premium unlocks every advanced privacy control",
  },
  chatCustomization: {
    title: "Chat customization is Premium",
    freeLimit: "Free uses the default chat look",
    premiumBenefit: "Premium unlocks backgrounds, bubbles and text styling",
  },
  initiateMessage: {
    title: "Starting new messages is Premium",
    freeLimit: "Free can only reply to people who message first",
    premiumBenefit: "Premium can send message requests to anyone",
  },
};

export function limitInfo(key: LimitKey): LimitInfo {
  return { key, ...LIMIT_COPY[key] };
}

export function limitsFor(plan: Plan): PlanLimits {
  return PLANS[plan];
}

export function formatAllowance(value: number): string {
  return Number.isFinite(value) ? String(value) : "Unlimited";
}
