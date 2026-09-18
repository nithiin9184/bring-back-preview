import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Check,
  Move,
  Palette,
  RotateCw,
  Send,
  X,
} from "lucide-react";
import type { StatusVisibility } from "@/data/types";
import {
  MAX_STATUS_VIDEO_SECONDS,
  formatSeconds,
  getVideoDuration,
  loadImage,
  readFileAsDataUrl,
  readVideoSource,
} from "@/lib/status/media";

export type StatusDraft = {
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
};

type Stage = "text" | "photo" | "video" | "preview";
type TextAlign = "left" | "center" | "right";

const TEXT_BACKGROUNDS = [
  "linear-gradient(160deg, oklch(0.58 0.19 258), oklch(0.46 0.16 268))",
  "linear-gradient(160deg, oklch(0.32 0.02 258), oklch(0.18 0.01 258))",
  "linear-gradient(160deg, oklch(0.72 0.14 150), oklch(0.55 0.13 165))",
  "linear-gradient(160deg, oklch(0.76 0.15 60), oklch(0.62 0.16 35))",
  "linear-gradient(160deg, oklch(0.66 0.2 355), oklch(0.5 0.19 320))",
];

const iconButton =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink/35 text-background backdrop-blur-sm transition-transform active:scale-95";
const lightIconButton =
  "grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft transition-transform active:scale-95";

function alignIcon(align: TextAlign) {
  if (align === "left") return <AlignLeft size={19} />;
  if (align === "right") return <AlignRight size={19} />;
  return <AlignCenter size={19} />;
}

function nextAlign(align: TextAlign): TextAlign {
  return align === "left" ? "center" : align === "center" ? "right" : "left";
}

export function StatusComposer({
  open,
  incomingFile,
  initialStage = "text",
  onClose,
  onPost,
}: {
  open: boolean;
  incomingFile?: File | null;
  initialStage?: "text" | "media";
  onClose: () => void;
  onPost: (draft: StatusDraft) => void;
}) {
  const [stage, setStage] = useState<Stage>("text");
  const [busy, setBusy] = useState(false);
  const [visibility, setVisibility] = useState<StatusVisibility>("public");
  const [text, setText] = useState("");
  const [textAlign, setTextAlign] = useState<TextAlign>("center");
  const [textY, setTextY] = useState(50);
  const [bgIndex, setBgIndex] = useState(0);
  const [photoSrc, setPhotoSrc] = useState("");
  const [rotation, setRotation] = useState(0);
  const [videoSrc, setVideoSrc] = useState("");
  const [videoDuration, setVideoDuration] = useState(0);
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [caption, setCaption] = useState("");
  const [preparedPhoto, setPreparedPhoto] = useState("");

  const mediaRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setStage("text");
    setBusy(false);
    setVisibility("public");
    setText("");
    setTextAlign("center");
    setTextY(50);
    setBgIndex(0);
    setPhotoSrc("");
    setRotation(0);
    setVideoSrc("");
    setVideoDuration(0);
    setTrim({ start: 0, end: 0 });
    setCaption("");
    setPreparedPhoto("");
  }, []);

  const acceptFile = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    setBusy(true);
    try {
      if (file.type.startsWith("video/")) {
        const source = await readVideoSource(file);
        const duration = await getVideoDuration(source);
        setVideoSrc(source);
        setVideoDuration(duration);
        setTrim({ start: 0, end: Math.min(duration, MAX_STATUS_VIDEO_SECONDS) });
        setCaption("");
        setStage("video");
      } else if (file.type.startsWith("image/")) {
        setPhotoSrc(await readFileAsDataUrl(file));
        setRotation(0);
        setCaption("");
        setStage("photo");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (!incomingFile && initialStage === "text") setStage("text");
  }, [open, incomingFile, initialStage, reset]);

  useEffect(() => {
    if (open && incomingFile) void acceptFile(incomingFile);
  }, [open, incomingFile, acceptFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || stage !== "video") return;
    const keepInsideSelection = () => {
      if (video.currentTime >= trim.end || video.currentTime < trim.start)
        video.currentTime = trim.start;
    };
    video.addEventListener("timeupdate", keepInsideSelection);
    return () => video.removeEventListener("timeupdate", keepInsideSelection);
  }, [stage, trim]);

  const selectedDuration = useMemo(() => formatSeconds(Math.max(0, trim.end - trim.start)), [trim]);

  if (!open) return null;

  const back = () => {
    if (stage === "preview") {
      setStage(videoSrc ? "video" : photoSrc ? "photo" : "text");
      return;
    }
    onClose();
  };

  const moveText = (event: React.PointerEvent<HTMLButtonElement>) => {
    const host = mediaRef.current;
    if (!host) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      setTextY(Math.min(82, Math.max(18, ((pointer.clientY - rect.top) / rect.height) * 100)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const dragHandle = (which: "start" | "end") => (event: React.PointerEvent<HTMLButtonElement>) => {
    const track = trackRef.current;
    if (!track || videoDuration <= 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = track.getBoundingClientRect();
    const move = (pointer: PointerEvent) => {
      const at =
        Math.min(1, Math.max(0, (pointer.clientX - rect.left) / rect.width)) * videoDuration;
      setTrim((current) => {
        if (which === "start") {
          const start = Math.max(0, Math.min(at, current.end - 1));
          return { start, end: Math.min(current.end, start + MAX_STATUS_VIDEO_SECONDS) };
        }
        const end = Math.min(videoDuration, Math.max(at, current.start + 1));
        return { start: Math.max(current.start, end - MAX_STATUS_VIDEO_SECONDS), end };
      });
      if (videoRef.current) videoRef.current.currentTime = at;
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const preparePhoto = async () => {
    setBusy(true);
    try {
      if (!rotation) setPreparedPhoto(photoSrc);
      else {
        const image = await loadImage(photoSrc);
        const sideways = rotation % 180 !== 0;
        const canvas = document.createElement("canvas");
        canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
        canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) setPreparedPhoto(photoSrc);
        else {
          context.translate(canvas.width / 2, canvas.height / 2);
          context.rotate((rotation * Math.PI) / 180);
          context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
          setPreparedPhoto(canvas.toDataURL("image/jpeg", 0.9));
        }
      }
      setStage("preview");
    } finally {
      setBusy(false);
    }
  };

  const publish = () => {
    const overlay = caption.trim()
      ? { caption: caption.trim() }
      : {};
    if (videoSrc) {
      onPost({
        video: videoSrc,
        videoStart: trim.start,
        videoEnd: trim.end,
        ...overlay,
        visibility,
      });
    } else if (photoSrc) {
      onPost({ image: preparedPhoto || photoSrc, ...overlay, visibility });
    } else {
      onPost({
        text: text.trim(),
        textAlign,
        textY,
        background: TEXT_BACKGROUNDS[bgIndex] as string,
        visibility,
      });
    }
    onClose();
  };

  const topBar = (dark = false) => (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-[max(14px,env(safe-area-inset-top))]">
      <button aria-label="Back" onClick={back} className={dark ? iconButton : lightIconButton}>
        <ArrowLeft size={19} strokeWidth={1.9} />
      </button>
      <button aria-label="Close" onClick={onClose} className={dark ? iconButton : lightIconButton}>
        <X size={18} strokeWidth={2} />
      </button>
    </header>
  );

  const mediaCanvas = (preview = false) => (
    <div className="flex h-full w-full flex-col bg-ink">
      <div ref={mediaRef} className="relative min-h-0 flex-1 overflow-hidden">
        {(preparedPhoto || photoSrc) && (
          <img
            src={preparedPhoto || photoSrc}
            alt="Status preview"
            className="h-full w-full object-contain"
            style={!preview ? { transform: `rotate(${rotation}deg)` } : undefined}
          />
        )}
        {videoSrc && (
          <video
            ref={preview ? undefined : videoRef}
            src={videoSrc}
            playsInline
            autoPlay
            muted
            onLoadedMetadata={(event) => (event.currentTarget.currentTime = trim.start)}
            onTimeUpdate={
              preview
                ? (event) => {
                    if (event.currentTarget.currentTime >= trim.end)
                      event.currentTarget.currentTime = trim.start;
                  }
                : undefined
            }
            className="h-full w-full object-contain"
          />
        )}
      </div>
      {preview ? (
        caption.trim() ? (
          <p className="shrink-0 whitespace-pre-wrap px-5 py-3 text-center text-[14px] font-medium leading-[1.45] text-background">
            {caption.trim()}
          </p>
        ) : null
      ) : (
        <textarea
          aria-label="Status caption"
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          rows={1}
          placeholder="Add a caption"
          className="min-h-12 shrink-0 resize-none bg-ink px-5 py-3 text-center text-[14px] font-medium leading-[1.45] text-background outline-none placeholder:text-background/55"
        />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] bg-background">
      <div className="relative mx-auto h-full w-full max-w-[430px] overflow-hidden bg-background">
        {stage === "text" && (
          <div
            ref={mediaRef}
            className="relative h-full"
            style={{ background: TEXT_BACKGROUNDS[bgIndex] }}
          >
            {topBar(true)}
            <div className="absolute inset-x-6 -translate-y-1/2" style={{ top: `${textY}%` }}>
              <button
                aria-label="Move text"
                onPointerDown={moveText}
                className="mx-auto mb-2 grid h-8 w-8 touch-none place-items-center rounded-full bg-ink/25 text-background"
              >
                <Move size={15} />
              </button>
              <textarea
                autoFocus
                aria-label="Status text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                placeholder="Type a status"
                className="w-full resize-none bg-transparent text-[25px] font-semibold leading-[1.35] text-background outline-none placeholder:text-background/65"
                style={{ textAlign }}
              />
            </div>
            <div className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-3 px-4 pb-[max(18px,env(safe-area-inset-bottom))]">
              <button
                aria-label="Change text alignment"
                onClick={() => setTextAlign(nextAlign(textAlign))}
                className={iconButton}
              >
                {alignIcon(textAlign)}
              </button>
              <button
                aria-label="Change background"
                onClick={() => setBgIndex((value) => (value + 1) % TEXT_BACKGROUNDS.length)}
                className={iconButton}
              >
                <Palette size={19} />
              </button>
              <button
                disabled={!text.trim()}
                onClick={() => setStage("preview")}
                className="ml-auto inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-[14px] font-semibold text-background shadow-soft disabled:opacity-50"
              >
                Next <Check size={17} />
              </button>
            </div>
          </div>
        )}

        {(stage === "photo" || stage === "video") && (
          <div className="relative flex h-full flex-col bg-ink">
            {topBar(true)}
            <div className="min-h-0 flex-1">{mediaCanvas()}</div>
            <div className="relative z-30 bg-ink px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 text-background">
              <div className="flex items-center gap-3">
                {stage === "photo" && (
                  <button
                    aria-label="Rotate photo"
                    onClick={() => setRotation((value) => (value + 90) % 360)}
                    className={iconButton}
                  >
                    <RotateCw size={19} />
                  </button>
                )}
                <button
                  aria-label="Change caption alignment"
                  onClick={() => setTextAlign(nextAlign(textAlign))}
                  className={iconButton}
                >
                  {alignIcon(textAlign)}
                </button>
                <span className="min-w-0 flex-1 text-center text-[12px] text-background/70">
                  {stage === "video" ? `Selected ${selectedDuration}` : "Photo ready"}
                </span>
                <button
                  aria-label="Next"
                  disabled={busy}
                  onClick={() => (stage === "photo" ? void preparePhoto() : setStage("preview"))}
                  className="grid h-12 w-12 place-items-center rounded-full bg-brand text-background disabled:opacity-50"
                >
                  <Check size={19} />
                </button>
              </div>
              {stage === "video" && videoDuration > MAX_STATUS_VIDEO_SECONDS && (
                <div className="mt-3">
                  <div className="mb-2 flex justify-between text-[11px] text-background/70">
                    <span>{formatSeconds(trim.start)}</span>
                    <span>{selectedDuration} selected · max 0:40</span>
                    <span>{formatSeconds(trim.end)}</span>
                  </div>
                  <div ref={trackRef} className="relative h-10 bg-background/20">
                    <div
                      className="absolute inset-y-0 border-y-2 border-brand bg-brand/20"
                      style={{
                        left: `${(trim.start / videoDuration) * 100}%`,
                        width: `${((trim.end - trim.start) / videoDuration) * 100}%`,
                      }}
                    />
                    <button
                      aria-label="Trim start"
                      onPointerDown={dragHandle("start")}
                      className="absolute top-1/2 h-12 w-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-md bg-brand"
                      style={{ left: `${(trim.start / videoDuration) * 100}%` }}
                    />
                    <button
                      aria-label="Trim end"
                      onPointerDown={dragHandle("end")}
                      className="absolute top-1/2 h-12 w-5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-md bg-brand"
                      style={{ left: `${(trim.end / videoDuration) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {stage === "preview" && (
          <div className="relative flex h-full flex-col bg-ink">
            {topBar(true)}
            <div className="min-h-0 flex-1">
              {photoSrc || videoSrc ? (
                mediaCanvas(true)
              ) : (
                <div className="relative h-full" style={{ background: TEXT_BACKGROUNDS[bgIndex] }}>
                  <p
                    className="absolute inset-x-7 -translate-y-1/2 whitespace-pre-wrap text-[25px] font-semibold leading-[1.35] text-background"
                    style={{ top: `${textY}%`, textAlign }}
                  >
                    {text}
                  </p>
                </div>
              )}
            </div>
            <div className="relative z-30 flex items-center gap-3 bg-ink px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 text-background">
              <span className="text-[12px] text-background/70">Share with</span>
              <div className="flex overflow-hidden rounded-full border border-background/30">
                {(["public", "private"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => setVisibility(option)}
                    className={`h-9 px-4 text-[12px] font-semibold capitalize ${visibility === option ? "bg-background text-ink" : "text-background"}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                onClick={publish}
                className="ml-auto inline-flex h-12 items-center gap-2 rounded-full bg-brand px-5 text-[14px] font-semibold text-background"
              >
                Publish <Send size={17} />
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
