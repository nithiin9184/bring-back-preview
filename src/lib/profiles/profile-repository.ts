/**
 * Profile lookup for N Connect.
 *
 * Profiles are server records. Another person's profile is read from the
 * database, which decides what may be shown (private accounts and blocks are
 * enforced there), and the signed-in account's own profile comes from the app
 * state that was hydrated from the same server record. Nothing is fabricated:
 * an unknown or unauthorised username resolves to undefined and screens show
 * their unavailable state.
 */

import { useEffect, useState } from "react";

import type { Profile } from "@/data/types";
import { loadPeerProfile } from "@/lib/account/account-repository";
import { useApp } from "@/lib/store";

/** Lowercases a handle and drops a leading "@". */
export function handleKey(username: string): string {
  return username.replace(/^@/, "").toLowerCase();
}

function fillProfile(partial: Partial<Profile>, fallbackHandle: string): Profile {
  return {
    id: partial.id ?? fallbackHandle,
    name: partial.name ?? "",
    username: partial.username ?? `@${fallbackHandle}`,
    bio: partial.bio ?? "",
    location: partial.location ?? "",
    followers: partial.followers ?? 0,
    following: partial.following ?? 0,
    likes: partial.likes ?? 0,
    private: partial.private ?? false,
    ...partial,
  } as Profile;
}

export type PeerProfileState = {
  /** The resolved profile, or undefined when it cannot be shown. */
  profile: Profile | undefined;
  /** True while the server is still answering. */
  loading: boolean;
};

/**
 * Resolves a profile by username. The signed-in account's own profile is
 * answered from state; anyone else is read from the server.
 */
export function usePeerProfile(username: string): PeerProfileState {
  const { me, ready } = useApp();
  const handle = handleKey(username);
  const mine = Boolean(me.username) && handleKey(me.username) === handle;
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [loading, setLoading] = useState(!mine);

  useEffect(() => {
    if (mine || !handle) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadPeerProfile(handle)
      .then((found) => {
        if (cancelled) return;
        setProfile(found ? fillProfile(found, handle) : undefined);
      })
      .catch(() => {
        if (!cancelled) setProfile(undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle, mine, ready]);

  if (mine) return { profile: fillProfile(me, handle), loading: false };
  return { profile, loading };
}
