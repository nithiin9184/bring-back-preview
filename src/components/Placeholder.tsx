import type { ReactNode } from "react";
import { Screen } from "@/components/ui-kit";
import { BottomNav } from "@/components/BottomNav";

export function Placeholder({
  title,
  note,
}: {
  title: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <main className="min-h-screen pb-28 pt-[max(18px,env(safe-area-inset-top))]">
      <Screen>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">{title}</h1>
        <p className="mt-1 text-[12px] text-ink-2">{note}</p>
        <div className="mt-8 rounded-[20px] border border-dashed border-line bg-white/60 px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">Coming next</p>
          <p className="mt-1 text-[12px] text-ink-3">This screen is a placeholder for now.</p>
        </div>
      </Screen>
      <BottomNav />
    </main>
  );
}
