/**
 * Real WebRTC call service.
 *
 * UI → this service → signaling / backend → WebRTC. The screens never touch
 * RTCPeerConnection, media tracks or the backend directly.
 *
 * Media (audio and video) is peer-to-peer and is never uploaded or stored on
 * the server; only the call record and the short-lived SDP / ICE messages
 * needed to connect the two devices pass through the backend.
 */

import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  acceptCall,
  callTick,
  endCall as endCallFn,
  startCall as startCallFn,
} from "./call.functions";
import type {
  CallLimitKey,
  CallPeer,
  CallType,
  EndReason,
  VideoCallListener,
  VideoCallService,
  VideoCallState,
} from "./call-types";

type Hooks = {
  /** A Free limit blocked the call: the existing Premium sheet is shown. */
  onLimit?: (limit: CallLimitKey) => void;
  onEnded?: (info: { connected: boolean; seconds: number }) => void;
  onNotice?: (message: string) => void;
};

type IceServer = { urls: string | string[]; username?: string; credential?: string };

function initial(callType: CallType = "video"): VideoCallState {
  return {
    status: "idle",
    callType,
    callId: null,
    incoming: false,
    localStream: null,
    remoteStream: null,
    seconds: 0,
    micOn: true,
    cameraOn: callType === "video",
    facing: "front",
    speakerOn: true,
  };
}

export function createWebRtcCallService(hooks: Hooks = {}): VideoCallService & {
  ringIncoming(call: { id: string; callType: CallType; peer: CallPeer }): void;
  dispose(): void;
} {
  const database = supabase as SupabaseClient<any>;
  let state = initial();
  const listeners = new Set<VideoCallListener>();

  let pc: RTCPeerConnection | null = null;
  let local: MediaStream | null = null;
  let remote: MediaStream | null = null;
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let ticker: ReturnType<typeof setInterval> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let callId: string | null = null;
  let selfId: string | null = null;
  let isCaller = false;
  let peer: CallPeer | null = null;
  let ice: IceServer[] = [];
  let pendingIce: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;
  let seenSignalIds = new Set<number>();

  const emit = () => {
    const snapshot = { ...state };
    listeners.forEach((l) => l(snapshot));
  };
  const set = (patch: Partial<VideoCallState>) => {
    state = { ...state, ...patch };
    emit();
  };

  async function me(): Promise<string | null> {
    if (selfId) return selfId;
    const { data } = await supabase.auth.getUser();
    selfId = data.user?.id ?? null;
    return selfId;
  }

  async function send(kind: "offer" | "answer" | "ice" | "reconnect", payload: unknown) {
    const sender = await me();
    if (!callId || !sender) return;
    await database.from("call_signals").insert({
      call_id: callId,
      sender_id: sender,
      kind,
      payload: payload as never,
    });
  }

  async function openMedia(callType: CallType, facing: "front" | "rear") {
    const constraints: MediaStreamConstraints = {
      audio: true,
      video:
        callType === "video" ? { facingMode: facing === "front" ? "user" : "environment" } : false,
    };
    local = await navigator.mediaDevices.getUserMedia(constraints);
    set({ localStream: local, cameraOn: callType === "video" });
  }

  function buildPeerConnection() {
    const connection = new RTCPeerConnection({ iceServers: ice });
    remote = new MediaStream();
    set({ remoteStream: remote });

    local?.getTracks().forEach((track) => connection.addTrack(track, local!));

    connection.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((t) => {
        if (!remote!.getTracks().includes(t)) remote!.addTrack(t);
      });
      set({ remoteStream: remote });
    };
    connection.onicecandidate = (event) => {
      if (event.candidate) void send("ice", event.candidate.toJSON());
    };
    connection.onconnectionstatechange = () => {
      const s = connection.connectionState;
      if (s === "connected") {
        if (state.status !== "connected") startClock();
        set({ status: "connected" });
      } else if (s === "disconnected") {
        set({ status: "reconnecting" });
      } else if (s === "failed") {
        void restartIce();
      }
    };
    pc = connection;
    return connection;
  }

  async function restartIce() {
    if (!pc || !isCaller) {
      set({ status: "reconnecting" });
      return;
    }
    set({ status: "reconnecting" });
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      await send("reconnect", offer);
    } catch {
      finish("failed", "Connection lost");
    }
  }

  function startClock() {
    if (ticker) return;
    ticker = setInterval(() => set({ seconds: state.seconds + 1 }), 1000);
    heartbeat = setInterval(async () => {
      if (!callId) return;
      const result = await callTick({ data: { callId } });
      if (!result.ok) return;
      if (result.ended) {
        hooks.onNotice?.("Free calls end after 5 minutes");
        finish("ended");
      } else if (typeof result.elapsed === "number") {
        set({ seconds: result.elapsed });
      }
    }, 5000);
  }

  function stopClock() {
    if (ticker) clearInterval(ticker);
    if (heartbeat) clearInterval(heartbeat);
    ticker = null;
    heartbeat = null;
  }

  async function handleSignal(row: {
    id: number;
    kind: string;
    sender_id: string;
    payload: unknown;
  }) {
    const sender = await me();
    if (row.sender_id === sender || seenSignalIds.has(row.id)) return;
    seenSignalIds.add(row.id);
    if (!pc) return;

    if (row.kind === "offer" || row.kind === "reconnect") {
      await pc.setRemoteDescription(
        new RTCSessionDescription(row.payload as RTCSessionDescriptionInit),
      );
      remoteDescriptionSet = true;
      await drainIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await send("answer", answer);
    } else if (row.kind === "answer") {
      if (pc.signalingState === "stable") return;
      await pc.setRemoteDescription(
        new RTCSessionDescription(row.payload as RTCSessionDescriptionInit),
      );
      remoteDescriptionSet = true;
      await drainIce();
    } else if (row.kind === "ice") {
      const candidate = row.payload as RTCIceCandidateInit;
      if (!remoteDescriptionSet) pendingIce.push(candidate);
      else await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }

  async function drainIce() {
    if (!pc) return;
    const queued = pendingIce;
    pendingIce = [];
    for (const candidate of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => undefined);
    }
  }

  function watch(id: string) {
    channel = supabase
      .channel(`call:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "call_signals", filter: `call_id=eq.${id}` },
        (payload) => void handleSignal(payload.new as never),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls", filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as { status: string };
          if (row.status === "connected" && state.status === "calling")
            set({ status: "connecting" });
          if (
            ["completed", "rejected", "missed", "busy", "failed", "cancelled"].includes(row.status)
          ) {
            if (row.status === "rejected" || row.status === "busy") {
              set({ status: "unavailable" });
              teardownMedia();
              hooks.onEnded?.({ connected: false, seconds: state.seconds });
            } else if (state.status !== "ended") {
              finish("ended");
            }
          }
        },
      )
      .subscribe();
  }

  function teardownMedia() {
    stopClock();
    local?.getTracks().forEach((t) => t.stop());
    remote?.getTracks().forEach((t) => t.stop());
    pc?.getSenders().forEach((s) => s.track?.stop());
    pc?.close();
    pc = null;
    local = null;
    remote = null;
    pendingIce = [];
    remoteDescriptionSet = false;
    seenSignalIds = new Set();
    if (channel) supabase.removeChannel(channel);
    channel = null;
  }

  function finish(status: "ended" | "failed", error?: string) {
    const connected = state.status === "connected" || state.status === "reconnecting";
    const seconds = state.seconds;
    teardownMedia();
    callId = null;
    if (status === "failed") {
      set({
        status: "failed",
        error: error ?? "Call failed",
        localStream: null,
        remoteStream: null,
      });
    } else {
      set({ ...initial(state.callType), status: "ended" });
      state = initial(state.callType);
    }
    hooks.onEnded?.({ connected, seconds });
  }

  return {
    getState: () => ({ ...state }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async start(nextPeer: CallPeer, callType: CallType = "video") {
      if (state.status !== "idle" && state.status !== "ended") return;
      peer = nextPeer;
      isCaller = true;
      state = { ...initial(callType), status: "calling", callType };
      emit();

      const result = await startCallFn({
        data: { peerUsername: nextPeer.username, callType },
      });
      if (!result.ok) {
        if (result.reason === "limit") {
          state = initial(callType);
          emit();
          hooks.onLimit?.(result.limit as CallLimitKey);
          return;
        }
        set({
          status: result.reason === "busy" ? "unavailable" : "failed",
          error:
            result.reason === "busy"
              ? "User is on another call"
              : result.reason === "rate_limited"
                ? "Too many call attempts. Try again in a minute."
                : result.reason === "blocked"
                  ? "You can't call this person"
                  : result.reason === "not_trusted"
                    ? "Calls need both of you to trust each other"
                    : "User unavailable right now",
        });
        return;
      }

      callId = result.callId;
      const activeCallId = result.callId;
      ice = result.iceServers as IceServer[];
      set({ callId: activeCallId });

      try {
        await openMedia(callType, state.facing);
      } catch {
        await endCallFn({ data: { callId: activeCallId, reason: "failed" } });
        finish("failed", "Camera or microphone unavailable");
        return;
      }

      watch(activeCallId);
      const connection = buildPeerConnection();
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await send("offer", offer);
    },

    /** Presents an inbound call on this device without answering it. */
    ringIncoming(call) {
      if (state.status !== "idle" && state.status !== "ended") return;
      peer = call.peer;
      isCaller = false;
      callId = call.id;
      state = {
        ...initial(call.callType),
        status: "calling",
        callType: call.callType,
        callId: call.id,
        incoming: true,
      };
      emit();
      watch(call.id);
    },

    async accept() {
      if (!callId || !state.incoming) return;
      const result = await acceptCall({ data: { callId } });
      if (!result.ok) {
        if (result.reason === "limit") {
          hooks.onLimit?.(result.limit as CallLimitKey);
          finish("ended");
          return;
        }
        finish(
          "failed",
          result.reason === "blocked"
            ? "You can't take calls from this person"
            : result.reason === "not_trusted"
              ? "Calls need both of you to trust each other"
              : "Call is no longer available",
        );
        return;
      }
      ice = result.iceServers as IceServer[];
      set({ status: "connecting", incoming: false });
      try {
        await openMedia(state.callType, state.facing);
      } catch {
        await endCallFn({ data: { callId, reason: "failed" } });
        finish("failed", "Camera or microphone unavailable");
        return;
      }
      buildPeerConnection();
      // The caller's offer arrives (or has arrived) over signaling; replay any
      // message that landed before the peer connection existed.
      const { data: rows } = await database
        .from("call_signals")
        .select("id, kind, sender_id, payload")
        .eq("call_id", callId)
        .order("id", { ascending: true });
      for (const row of rows ?? []) await handleSignal(row as never);
    },

    end(reason: EndReason = "hangup") {
      const id = callId;
      const wasIncoming = state.incoming;
      if (id) {
        void endCallFn({
          data: { callId: id, reason: wasIncoming && reason === "hangup" ? "rejected" : reason },
        });
      }
      finish("ended");
    },

    toggleMic() {
      const next = !state.micOn;
      local?.getAudioTracks().forEach((t) => (t.enabled = next));
      set({ micOn: next });
    },

    toggleCamera() {
      const next = !state.cameraOn;
      local?.getVideoTracks().forEach((t) => (t.enabled = next));
      set({ cameraOn: next });
    },

    async switchCamera() {
      if (state.callType !== "video" || !local || !pc) return;
      const facing = state.facing === "front" ? "rear" : "front";
      try {
        const replacement = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing === "front" ? "user" : "environment" },
        });
        const track = replacement.getVideoTracks()[0];
        if (!track) return;
        const sender = pc.getSenders().find((s) => s.track?.kind === "video");
        await sender?.replaceTrack(track);
        local.getVideoTracks().forEach((t) => {
          t.stop();
          local?.removeTrack(t);
        });
        local.addTrack(track);
        track.enabled = state.cameraOn;
        set({ facing, localStream: local });
      } catch {
        hooks.onNotice?.("No second camera available");
      }
    },

    toggleSpeaker() {
      set({ speakerOn: !state.speakerOn });
    },

    dispose() {
      const id = callId;
      if (id) void endCallFn({ data: { callId: id, reason: "hangup" } });
      teardownMedia();
      callId = null;
      listeners.clear();
    },
  };
}
