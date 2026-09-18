/**
 * The single limit / upgrade sheet used everywhere a Free restriction bites.
 * Mounted once by AppProvider's consumer in __root, opened via `require()`.
 */

import { useNavigate } from "@tanstack/react-router";
import { Crown, Check } from "lucide-react";
import { useApp } from "@/lib/store";
import { PLAN_LIST } from "@/lib/entitlements";

export function PremiumSheet() {
  const { limitSheet, closeLimit, upgrade } = useApp();
  const navigate = useNavigate();

  if (!limitSheet) return null;

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        aria-label="Close"
        onClick={closeLimit}
        className="absolute inset-0 bg-overlay backdrop-blur-[2px]"
        style={{ animation: "rise-in 200ms ease both" }}
      />
      <div className="absolute inset-x-0 bottom-0 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[430px] px-3 pb-3">
          <div
            className="glass overflow-hidden rounded-2xl px-4 pb-3 pt-2.5"
            style={{ animation: "rise-in 260ms cubic-bezier(0.22,1,0.36,1) both" }}
          >
            <span className="mx-auto mb-3 block h-1 w-9 rounded-full bg-ink/15" />

            <div className="flex items-start gap-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sky text-brand shadow-soft">
                <Crown size={17} strokeWidth={1.9} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-ink">{limitSheet.title}</p>
                <p className="mt-1 text-[12px] text-ink-2">{limitSheet.freeLimit}</p>
              </div>
            </div>

            <p className="mt-3 flex items-start gap-2 text-[12.5px] text-ink">
              <Check size={14} strokeWidth={2.2} className="mt-0.5 shrink-0 text-brand" />
              {limitSheet.premiumBenefit}
            </p>

            <p className="mt-2.5 text-[11.5px] text-ink-3">
              Either plan unlocks everything
            </p>

            {PLAN_LIST.map((option, i) => (
              <button
                key={option.id}
                type="button"
                onClick={() => upgrade(option.id)}
                className={`${i === 0 ? "mt-3" : "mt-2"} h-11 w-full rounded-[23px] bg-ink text-[13.5px] font-semibold text-background active:scale-[0.98]`}
              >
                {option.price} {option.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                closeLimit();
                navigate({ to: "/settings/$section", params: { section: "premium" } });
              }}
              className="mt-2 h-10 w-full rounded-[21px] border border-line bg-surface text-[12.5px] font-semibold text-ink"
            >
              See everything in Premium
            </button>
            <button
              type="button"
              onClick={closeLimit}
              className="mt-1.5 h-9 w-full text-[12.5px] font-medium text-ink-2"
            >
              Maybe Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Global lightweight toast driven by the store. */
export function AppToast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[70] flex justify-center px-4">
      <span className="glass rounded-full px-4 py-2 text-[12px] font-medium text-ink">{toast}</span>
    </div>
  );
}
