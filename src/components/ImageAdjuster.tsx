import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";

/**
 * Profile photo adjustment step.
 *
 * Shown after picking an image: the user can zoom, reposition and crop before
 * the square result is saved as the profile photo. Uses the existing N Connect
 * surface tokens only.
 */
export function ImageAdjuster({
  src,
  onCancel,
  onSave,
}: {
  src: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
    imgRef.current = img;
  }, [src]);

  const boxSize = () => boxRef.current?.clientWidth ?? 300;

  const baseScale = () => {
    const d = boxSize();
    if (!natural.w || !natural.h) return 1;
    return Math.max(d / natural.w, d / natural.h);
  };

  // Keep the picture covering the crop window while it is moved around.
  const clamp = (next: { x: number; y: number }, z = zoom) => {
    const d = boxSize();
    const s = baseScale() * z;
    const maxX = Math.max(0, (natural.w * s - d) / 2);
    const maxY = Math.max(0, (natural.h * s - d) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, next.x)),
      y: Math.min(maxY, Math.max(-maxY, next.y)),
    };
  };

  useEffect(() => setOffset((o) => clamp(o)), [zoom, natural.w, natural.h]);

  const save = () => {
    const out = 512;
    const d = boxSize();
    const img = imgRef.current;
    if (!img || !natural.w) return;
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const f = out / d;
    const s = baseScale() * zoom * f;
    const w = natural.w * s;
    const h = natural.h * s;
    ctx.drawImage(img, out / 2 + offset.x * f - w / 2, out / 2 + offset.y * f - h / 2, w, h);
    onSave(canvas.toDataURL("image/jpeg", 0.9));
  };

  const s = baseScale() * zoom;

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 pt-[max(14px,env(safe-area-inset-top))]">
      <header className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          aria-label="Cancel photo adjustment"
          onClick={onCancel}
          className="grid h-9 w-9 place-items-center rounded-full text-white/90"
        >
          <X size={19} strokeWidth={1.8} />
        </button>
        <p className="text-[13.5px] font-semibold text-white">Adjust photo</p>
        <button
          type="button"
          aria-label="Save profile photo"
          onClick={save}
          className="grid h-9 w-9 place-items-center rounded-full text-white"
        >
          <Check size={20} strokeWidth={2.1} />
        </button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div
          ref={boxRef}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className="relative aspect-square w-full max-w-[320px] touch-none overflow-hidden rounded-full"
        >
          {natural.w > 0 && (
            <img
              src={src}
              alt="Profile photo preview"
              draggable={false}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: natural.w * s,
                height: natural.h * s,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            />
          )}
        </div>

        <label className="mt-7 w-full max-w-[320px]">
          <span className="mb-2 block text-center text-[11.5px] text-white/70">
            Pinch or drag to reposition · slide to zoom
          </span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            aria-label="Zoom"
            className="w-full accent-white"
          />
        </label>
      </div>

      <div className="flex items-center justify-center gap-3 px-6 pb-[max(18px,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 flex-1 rounded-[23px] border border-white/30 text-[14px] font-semibold text-white"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          className="h-11 flex-1 rounded-[23px] bg-white text-[14px] font-semibold text-ink"
        >
          Save photo
        </button>
      </div>
    </div>
  );
}
