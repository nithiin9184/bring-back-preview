/**
 * Owns the one live call for the whole app.
 *
 * UI → CallProvider → call service → signaling/backend → WebRTC. Screens only
 * ask to start a call; every entitlement decision comes back from the backend.
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
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBackend } from "./backend";
import { useApp } from "@/lib/store";
import { VideoCallOverlay } from "@/components/VideoCallOverlay";
import { VoiceCallOverlay } from "@/components/VoiceCallOverlay";
import { createWebRtcCallService } from "./webrtc-call-service";
import type { CallPeer, CallType, VideoCallState } from "./call-types";

type Ctx = {
  call: VideoCallState | null;
  /** Who the current call is with; null when no call is in progress. */
  peer: CallPeer | null;
  startCall: (peer: CallPeer, callType: CallType) => void;
};

const CallContext = createContext<Ctx | null>(null);

export function useCall(): Ctx {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside <CallProvider>");
  return ctx;
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { showLimit, notify, refreshEntitlements } = useApp();
  const [call, setCall] = useState<VideoCallState | null>(null);
  const [peer, setPeer] = useState<CallPeer>({ name: "", username: "" });
  const serviceRef = useRef<ReturnType<typeof createWebRtcCallService> | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const localRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  if (!serviceRef.current && typeof window !== "undefined") {
    serviceRef.current = createWebRtcCallService({
      onLimit: (limit) => showLimit(limit),
      onNotice: (message) => notify(message),
    });
  }

  useEffect(() => {
    const service = serviceRef.current;
    if (!service) return;
    const off = service.subscribe((s) => setCall(s.status === "idle" ? null : s));
    return () => {
      off();
      service.dispose();
      serviceRef.current = null;
    };
  }, []);

  // Premium comes from the backend subscription record, never a client flag.
  useEffect(() => {
    // The plan itself lives on the server; re-read it whenever the signed-in
    // account changes. Without a backend the app keeps working on Free.
    const supabase = getBackend();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED")
        refreshEntitlements();
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [refreshEntitlements]);

  // Inbound calls for the signed-in account.
  useEffect(() => {
    // No backend means no inbound call signalling to listen for.
    const supabase = getBackend();
    if (!supabase) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid || cancelled) return;
      channel = supabase
        .channel(`incoming:${uid}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "calls", filter: `callee_id=eq.${uid}` },
          async (payload) => {
            const row = payload.new as {
              id: string;
              caller_id: string;
              call_type: CallType;
              status: string;
            };
            if (row.status !== "ringing") return;
            const database = supabase as SupabaseClient<any>;
            const { data: caller } = await database
              .from("profiles")
              .select("name, username")
              .eq("id", row.caller_id)
              .maybeSingle();
            const from = {
              name: caller?.name || caller?.username || "N Connect user",
              username: caller?.username ?? "",
            };
            setPeer(from);
            serviceRef.current?.ringIncoming({ id: row.id, callType: row.call_type, peer: from });
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Attach live media to the existing screen's elements.
  useEffect(() => {
    if (remoteRef.current && call?.remoteStream) remoteRef.current.srcObject = call.remoteStream;
    if (localRef.current && call?.localStream) localRef.current.srcObject = call.localStream;
    if (audioRef.current && call?.remoteStream) audioRef.current.srcObject = call.remoteStream;
  }, [call?.remoteStream, call?.localStream, call?.status]);

  const startCall = useCallback(
    (nextPeer: CallPeer, callType: CallType) => {
      // Calls need the backend; say so in the app instead of crashing the page.
      if (!getBackend()) {
        notify("Calling is unavailable right now");
        return;
      }
      setPeer(nextPeer);
      void serviceRef.current?.start(nextPeer, callType);
    },
    [notify],
  );

  const value = useMemo<Ctx>(
    () => ({ call, peer: call && peer.name ? peer : null, startCall }),
    [call, peer, startCall],
  );
  const service = serviceRef.current;

  return (
    <CallContext.Provider value={value}>
      {children}
      {call && call.callType === "voice" && (
        <>
          <VoiceCallOverlay
            peer={peer}
            state={call}
            onToggleMic={() => service?.toggleMic()}
            onAccept={() => void service?.accept?.()}
            onEnd={() => service?.end("hangup")}
          />
          <audio ref={audioRef} autoPlay playsInline className="hidden" />
        </>
      )}
      {call && call.callType === "video" && (
        <VideoCallOverlay
          peer={peer}
          state={call}
          remoteRef={remoteRef}
          localRef={localRef}
          onToggleMic={() => service?.toggleMic()}
          onToggleCamera={() => service?.toggleCamera()}
          onSwitchCamera={() => void service?.switchCamera()}
          onToggleSpeaker={() => service?.toggleSpeaker()}
          onAccept={() => void service?.accept?.()}
          onEnd={() => service?.end("hangup")}
        />
      )}
    </CallContext.Provider>
  );
}
