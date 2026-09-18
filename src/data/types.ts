/**
 * Shared data shapes for N Connect.
 *
 * Types only. All runtime state
 * lives in `src/lib/store.tsx`, so it can be swapped for a real backend
 * without touching the screens.
 */

export type Person = {
  id: string;
  name: string;
  username: string;
  location: string;
  state: "follow" | "following" | "requested";
  /** Permanent 7-digit N Connect Contact ID, when known. */
  contactId?: string;
};

/** Status privacy: public follows account visibility, private follows the user's rules. */
export type StatusVisibility = "public" | "private";

/** A 24-hour status update. Separate from posts, reels and stories. */
export type StatusEntry = {
  id: string;
  authorUsername: string;
  authorName: string;
  /** Permanent Contact ID of the author. */
  authorContactId?: string;
  text?: string;
  /** Data URL of the picked image, when the status is a photo. */
  image?: string;
  /** Source of a video status (data URL for small clips, object URL otherwise). */
  video?: string;
  /** Playback window of a trimmed video status, in seconds. */
  videoStart?: number;
  videoEnd?: number;
  /** Caption rendered directly over a photo or video status. */
  caption?: string;
  /** Caption position as percentages of the media canvas. */
  captionX?: number;
  captionY?: number;
  /** Text alignment for captions and text-only statuses. */
  textAlign?: "left" | "center" | "right";
  /** Vertical position for a text-only status, as a percentage. */
  textY?: number;
  /** Background of a text-only status (CSS background value). */
  background?: string;
  /** Epoch milliseconds; the entry expires 24 hours later. */
  createdAt: number;
  visibility: StatusVisibility;
  /** True when the backend already decided this account may see the status. */
  serverAuthorized?: boolean;
  /** People who opened this status, newest last. */
  views?: StatusView[];
};

/** One recorded view of a status. */
export type StatusView = {
  username: string;
  name: string;
  /** Data URL of the viewer's photo, when known. */
  photo?: string;
  /** Epoch milliseconds of the view. */
  at: number;
  /**
   * How the viewer reached the status: "private" when they are an approved
   * contact/follower, "public" when they saw it through public visibility.
   */
  audience?: StatusVisibility;
};

export type Profile = {
  id: string;
  name: string;
  username: string;
  bio: string;
  location: string;
  followers: number;
  following: number;
  likes: number;
  private?: boolean;
  relation?: "follow" | "following" | "requested";
  likedByMe?: boolean;
  premium?: boolean;
  /** Data URL of the photo the user picked, empty when none. */
  photo?: string;
  /** Locality fields captured during account creation. */
  village?: string;
  city?: string;
  state?: string;
  pin?: string;
  /** Verified phone number from the OTP flow. Never shown publicly. */
  phone?: string;
  /**
   * Permanent, globally unique 7-digit Contact ID. Generated once at account
   * creation, never editable and never regenerated.
   */
  contactId?: string;
};

export type NotificationType =
  | "follower"
  | "request"
  | "accepted"
  | "like"
  | "message"
  | "message_request"
  | "call"
  | "security";

export type AppNotification = {
  id: string;
  type: NotificationType;
  name: string;
  username?: string;
  text: string;
  time: string;
  unread?: boolean;
  tone?: "default" | "warning" | "success";
};

export type ChatRow = {
  id: string;
  name: string;
  username: string;
  message: string;
  time: string;
  online: boolean;
  lastSeen?: string;
  unread?: number;
  typing?: boolean;
  disappearing?: boolean;
  pinned?: boolean;
  muted?: boolean;
  archived?: boolean;
  /** false until the recipient accepts a message request */
  accepted?: boolean;
};

export type MessageState = "sent" | "delivered" | "read";

export type ChatMessage = {
  id: string;
  mine: boolean;
  text?: string | undefined;
  images?: string[] | undefined;
  time: string;
  state?: MessageState | undefined;
  reaction?: string | undefined;
  replyTo?: string | undefined;
  edited?: boolean | undefined;
  deleted?: boolean | undefined;
};

export type MessageRequest = {
  id: string;
  name: string;
  username: string;
  location: string;
  preview: string;
  time: string;
  /** "incoming" waits on me, "outgoing" waits on them */
  direction: "incoming" | "outgoing";
};

export type BlockedPerson = Person & { since: string };

/**
 * A pending Contact Request. Sending one never adds the person to Contacts —
 * the recipient chooses Delete, Accept Chat or Accept Contact.
 */
export type ContactRequest = {
  id: string;
  name: string;
  username: string;
  /** Permanent 7-digit Contact ID of the other person, when known. */
  contactId?: string;
  time: string;
  /** "incoming" waits on me, "outgoing" waits on them */
  direction: "incoming" | "outgoing";
};

/** A saved contact. */
export type ContactEntry = {
  id: string;
  name: string;
  username: string;
  contactId?: string;
  addedAt: number;
};

/**
 * Per-person trust. Images, voice calls and video calls stay disabled until
 * both sides have independently chosen "Trust this User".
 */
export type TrustState = { mine: boolean; theirs: boolean };
