/**
 * Small, non-intrusive ad strip shown to Free users only.
 * Hidden entirely once the account is on Premium.
 */

import { useNavigate } from "@tanstack/react-router";
import { Crown } from "lucide-react";
import { useApp } from "@/lib/store";

const lines = [
  { title: "Chai Point · 20% off today", note: "Sponsored" },
  { title: "Learn Kathak online", note: "Sponsored" },
  { title: "Pune Book Fair this weekend", note: "Sponsored" },
];

export function AdSlot({ index = 0, className = "" }: { index?: number; className?: string }) {
  const { limits } = useApp();
  const navigate = useNavigate();
  if (!limits.ads) return null;
  const ad = lines[index % lines.length]!;

  return (
    <div
      className={`mt-4 flex items-center gap-2.5 rounded-[18px] border border-line bg-surface px-3 py-2 shadow-soft ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{ad.title}</span>
        <span className="block text-[10px] uppercase tracking-[0.06em] text-ink-3">{ad.note}</span>
      </span>
      <button
        type="button"
        onClick={() => navigate({ to: "/settings/$section", params: { section: "premium" } })}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 text-[11px] font-semibold text-ink-2"
      >
        <Crown size={12} strokeWidth={2} />
        Remove
      </button>
    </div>
  );
}
