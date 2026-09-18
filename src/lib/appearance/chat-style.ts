/**
 * Chat appearance: the five chat fonts and the four bubble colours.
 *
 * Both values live in the account settings saved on the server, so the choice
 * follows the account to any device. The Premium-only options are described
 * here but never enforced here — the screens ask the existing entitlement
 * system (`limits.chatCustomization` / `require("chatCustomization")`).
 */

import type { CSSProperties } from "react";

export type ChatFont = {
  /** Stored value in account settings. */
  name: string;
  /** CSS font stack, with fallbacks that always resolve to something readable. */
  stack: string;
  /** Requires the Premium chat customization entitlement. */
  premium: boolean;
};

const SYSTEM = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, sans-serif`;

export const CHAT_FONTS: ChatFont[] = [
  { name: "SF Pro", stack: SYSTEM, premium: false },
  {
    name: "OnePlus One Sans",
    // Shipped on OnePlus/OxygenOS devices; elsewhere it falls back gracefully.
    stack: `"OnePlus One Sans", "OnePlus Sans", "OnePlus Slate", "Noto Sans", ${SYSTEM}`,
    premium: true,
  },
  { name: "Inter", stack: `"Inter", ${SYSTEM}`, premium: false },
  {
    name: "Plus Jakarta Sans",
    stack: `"Plus Jakarta Sans", "Inter", ${SYSTEM}`,
    premium: true,
  },
  { name: "Satoshi", stack: `"Satoshi", "Inter", ${SYSTEM}`, premium: true },
];

export const DEFAULT_CHAT_FONT = "SF Pro";

/** Fonts a plan may choose. Free keeps SF Pro and Inter. */
export function allowedChatFonts(chatCustomization: boolean): ChatFont[] {
  return chatCustomization ? CHAT_FONTS : CHAT_FONTS.filter((f) => !f.premium);
}

export function isChatFontLocked(name: string, chatCustomization: boolean): boolean {
  if (chatCustomization) return false;
  return CHAT_FONTS.find((f) => f.name === name)?.premium ?? false;
}

/** The CSS stack for a stored value; unknown or legacy values use SF Pro. */
export function chatFontStack(name: string | undefined): string {
  return CHAT_FONTS.find((f) => f.name === name)?.stack ?? SYSTEM;
}

/** The stored value normalised to a font this account may actually use. */
export function resolvedChatFont(name: string | undefined, chatCustomization: boolean): string {
  const font = CHAT_FONTS.find((f) => f.name === name);
  if (!font) return DEFAULT_CHAT_FONT;
  if (font.premium && !chatCustomization) return DEFAULT_CHAT_FONT;
  return font.name;
}

/* ----------------------------------------------------------- bubble colour */

export type BubbleColour = {
  name: string;
  premium: boolean;
  /** Outgoing bubble. */
  mine: CSSProperties;
  /** Incoming bubble. */
  theirs: CSSProperties;
  /** Small swatch used by the picker. */
  swatch: string;
};

const INCOMING: CSSProperties = {
  backgroundColor: "rgb(255 255 255 / 0.9)",
  color: "var(--ink)",
};

export const BUBBLE_COLOURS: BubbleColour[] = [
  {
    name: "Classic",
    premium: false,
    mine: { backgroundColor: "var(--bubble-classic)", color: "var(--bubble-classic-ink)" },
    theirs: INCOMING,
    swatch: "var(--bubble-classic)",
  },
  {
    name: "Sky",
    premium: true,
    mine: { backgroundColor: "var(--bubble-sky)", color: "var(--bubble-sky-ink)" },
    theirs: INCOMING,
    swatch: "var(--bubble-sky)",
  },
  {
    name: "Peach",
    premium: true,
    mine: { backgroundColor: "var(--bubble-peach)", color: "var(--bubble-peach-ink)" },
    theirs: INCOMING,
    swatch: "var(--bubble-peach)",
  },
  {
    name: "Violet",
    premium: true,
    mine: { backgroundColor: "var(--bubble-violet)", color: "var(--bubble-violet-ink)" },
    theirs: INCOMING,
    swatch: "var(--bubble-violet)",
  },
];

export const DEFAULT_BUBBLE_COLOUR = "Classic";

export function isBubbleColourLocked(name: string, chatCustomization: boolean): boolean {
  if (chatCustomization) return false;
  return BUBBLE_COLOURS.find((c) => c.name === name)?.premium ?? false;
}

/** Inline style for one bubble, honouring the account's colour choice. */
export function bubbleStyle(
  name: string | undefined,
  mine: boolean,
  chatCustomization: boolean,
): CSSProperties {
  const chosen = BUBBLE_COLOURS.find((c) => c.name === name);
  const colour =
    chosen && (!chosen.premium || chatCustomization)
      ? chosen
      : (BUBBLE_COLOURS[0] as BubbleColour);
  return mine ? colour.mine : colour.theirs;
}
