/**
 * Voice call surface — the existing N Connect voice screen, now driven by the
 * real call service. Layout, spacing and controls are unchanged.
 */

import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import type { VideoCallState } from "@/lib/calls/call-types";

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type Props = {
  peer: { name: string };
  state: VideoCallState;
  onToggleMic: () => void;
  onAccept: () => void;
  onEnd: () => void;
};

export function VoiceCallOverlay({ peer, state, onToggleMic, onAccept, onEnd }: Props) {
  const line =
    state.status === "unavailable"
      ? "User unavailable right now"
      : state.status === "failed"
        ? (state.error ?? "Call failed")
        : state.status === "reconnecting"
          ? "Reconnecting…"
          : state.incoming
            ? "Incoming voice call"
            : state.status !== "connected"
              ? "Encrypted voice call · ringing…"
              : `Encrypted voice call · ${clock(state.seconds)}`;

  return (
    <div className="fixed inset-0 z-50 bg-ink/95">
      <div className="mx-auto flex h-full w-full max-w-[430px] flex-col items-center px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-24 text-center">
        <Avatar name={peer.name} seed={7} size={104} />
        <p className="mt-4 text-[18px] font-semibold text-background">{peer.name}</p>
        <p className="mt-1 text-[12.5px] text-background/70">{line}</p>
        <div className="mt-auto flex items-center gap-5">
          {state.incoming ? (
            <button
              aria-label="Accept call"
              onClick={onAccept}
              className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white"
            >
              <Phone size={24} strokeWidth={1.9} />
            </button>
          ) : (
            <button
              aria-label="Mute call"
              onClick={onToggleMic}
              className="grid h-14 w-14 place-items-center rounded-full bg-white/15 text-background"
            >
              {state.micOn ? (
                <Mic size={22} strokeWidth={1.9} />
              ) : (
                <MicOff size={22} strokeWidth={1.9} />
              )}
            </button>
          )}
          <button
            aria-label="End call"
            onClick={onEnd}
            className="grid h-16 w-16 place-items-center rounded-full bg-red-500 text-white"
          >
            <PhoneOff size={24} strokeWidth={1.9} />
          </button>
        </div>
      </div>
    </div>
  );
}
