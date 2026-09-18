/**
 * Full-screen video call surface, driven by the real WebRTC call service.
 * Layout unchanged: the remote stream fills the surface and the local preview
 * uses the existing preview box.
 */

import type { RefObject } from "react";
import {
  Mic,
  Phone,
  MicOff,
  PhoneOff,
  RefreshCw,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import type { VideoCallState } from "@/lib/calls/call-types";

function clock(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function statusLine(state: VideoCallState): string {
  switch (state.status) {
    case "calling":
      return state.incoming ? "Incoming video call" : "Encrypted video call · calling…";
    case "connecting":
      return "Encrypted video call · connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "connected":
      return `Encrypted video call · ${clock(state.seconds)}`;
    case "unavailable":
      return "User unavailable right now";
    case "failed":
      return state.error ?? "Call failed";
    default:
      return "";
  }
}

type Props = {
  peer: { name: string };
  state: VideoCallState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onSwitchCamera: () => void;
  onToggleSpeaker: () => void;
  onAccept: () => void;
  onEnd: () => void;
  remoteRef: RefObject<HTMLVideoElement | null>;
  localRef: RefObject<HTMLVideoElement | null>;
};

export function VideoCallOverlay({
  peer,
  state,
  onToggleMic,
  onToggleCamera,
  onSwitchCamera,
  onToggleSpeaker,
  onAccept,
  onEnd,
  remoteRef,
  localRef,
}: Props) {
  const failed = state.status === "failed" || state.status === "unavailable";
  const pill = "grid h-14 w-14 place-items-center rounded-full bg-white/15 text-background";

  return (
    <div className="fixed inset-0 z-50 bg-ink/95">
      <video
        ref={remoteRef}
        autoPlay
        playsInline
        muted={!state.speakerOn}
        className={`absolute inset-0 h-full w-full object-cover ${
          state.remoteStream && state.status === "connected" ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="relative mx-auto flex h-full w-full max-w-[430px] flex-col items-center px-6 pb-[max(24px,env(safe-area-inset-bottom))] pt-24 text-center">
        <Avatar name={peer.name} seed={7} size={104} />
        <p className="mt-4 text-[18px] font-semibold text-background">{peer.name}</p>
        <p className="mt-1 text-[12.5px] text-background/70">{statusLine(state)}</p>

        {!failed && (
          <div className="relative mt-6 grid h-[150px] w-[112px] place-items-center overflow-hidden rounded-[18px] border border-white/20 bg-white/10 text-[11px] text-background/70">
            <video
              ref={localRef}
              autoPlay
              playsInline
              muted
              className={`absolute inset-0 h-full w-full object-cover ${
                state.cameraOn && state.localStream ? "opacity-100" : "opacity-0"
              }`}
            />
            {!state.cameraOn && <span className="relative">Camera off</span>}
          </div>
        )}

        {failed ? (
          <div className="mt-auto flex flex-col items-center gap-3">
            <button
              onClick={onEnd}
              className="h-12 rounded-full bg-white/15 px-7 text-[14px] font-semibold text-background"
            >
              Return to chat
            </button>
          </div>
        ) : (
          <div className="mt-auto flex flex-col items-center gap-5">
            <div className="flex items-center gap-4">
              <button aria-label="Toggle microphone" onClick={onToggleMic} className={pill}>
                {state.micOn ? (
                  <Mic size={21} strokeWidth={1.9} />
                ) : (
                  <MicOff size={21} strokeWidth={1.9} />
                )}
              </button>
              <button aria-label="Toggle camera" onClick={onToggleCamera} className={pill}>
                {state.cameraOn ? (
                  <Video size={21} strokeWidth={1.9} />
                ) : (
                  <VideoOff size={21} strokeWidth={1.9} />
                )}
              </button>
              <button aria-label="Switch camera" onClick={onSwitchCamera} className={pill}>
                <SwitchCamera size={21} strokeWidth={1.9} />
              </button>
              <button aria-label="Toggle speaker" onClick={onToggleSpeaker} className={pill}>
                {state.speakerOn ? (
                  <Volume2 size={21} strokeWidth={1.9} />
                ) : (
                  <VolumeX size={21} strokeWidth={1.9} />
                )}
              </button>
            </div>
            <div className="flex items-center gap-5">
              {state.incoming && (
                <button
                  aria-label="Accept video call"
                  onClick={onAccept}
                  className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white"
                >
                  <Phone size={24} strokeWidth={1.9} />
                </button>
              )}
              {state.status === "reconnecting" && (
                <span className="grid h-12 w-12 place-items-center rounded-full bg-white/10 text-background/70">
                  <RefreshCw size={19} strokeWidth={1.9} className="animate-spin" />
                </span>
              )}
              <button
                aria-label="End video call"
                onClick={onEnd}
                className="grid h-16 w-16 place-items-center rounded-full bg-red-500 text-white"
              >
                <PhoneOff size={24} strokeWidth={1.9} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
