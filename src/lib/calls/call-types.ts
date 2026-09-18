/**
 * Shared call types.
 *
 * The UI only talks to this interface; the single implementation is the real
 * WebRTC call service backed by N Connect signaling.
 */

export type VideoCallStatus =
  | "idle"
  | "calling"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "ended"
  | "failed"
  | "unavailable";

export type CallType = "voice" | "video";

export type VideoCallState = {
  status: VideoCallStatus;
  /** Voice and video share one call pipeline, entitlement and signaling path. */
  callType: CallType;
  /** Backend call record id, once the call exists. */
  callId: string | null;
  /** True while an inbound call is ringing on this device. */
  incoming: boolean;
  /** Live media, attached to the existing screen's video elements. */
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  /** Seconds since the call connected. */
  seconds: number;
  micOn: boolean;
  cameraOn: boolean;
  facing: "front" | "rear";
  speakerOn: boolean;
  error?: string;
};

export type VideoCallListener = (state: VideoCallState) => void;

export type CallPeer = { name: string; username: string };

/** Why a call ended, for the backend usage record. */
export type EndReason = "hangup" | "rejected" | "missed" | "busy" | "failed" | "limit";

/** A Free limit that blocked the call, mapped to the existing Premium sheet. */
export type CallLimitKey = "calls" | "callMinutes";

export type VideoCallService = {
  start(peer: CallPeer, callType?: CallType): void | Promise<void>;
  /** Answers the ringing inbound call, when the implementation supports one. */
  accept?(): void | Promise<void>;
  end(reason?: EndReason): void;
  toggleMic(): void;
  toggleCamera(): void;
  switchCamera(): void;
  toggleSpeaker(): void;
  subscribe(listener: VideoCallListener): () => void;
  getState(): VideoCallState;
};
