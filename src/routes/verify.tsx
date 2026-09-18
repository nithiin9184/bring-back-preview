import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useApp } from "@/lib/store";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Screen } from "@/components/ui-kit";
import { useServerFn } from "@tanstack/react-start";
import { resendPhoneOtp, verifyPhoneOtp } from "@/lib/auth/phone-auth.functions";
import { supabase } from "@/integrations/supabase/client";
import { formatPhone } from "@/lib/auth/countries";

type Search = { phone: string };

export const Route = createFileRoute("/verify")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    phone: typeof search["phone"] === "string" ? search["phone"] : "",
  }),
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Verify your number — N Connect" },
      {
        name: "description",
        content: "Enter the six digit WhatsApp code to verify your N Connect number.",
      },
      { property: "og:title", content: "Verify your number — N Connect" },
      {
        property: "og:description",
        content: "Confirm your number with a six digit WhatsApp code.",
      },
    ],
  }),
  component: VerifyScreen,
});

type Status = "idle" | "loading" | "invalid" | "expired";

function VerifyScreen() {
  const navigate = useNavigate();
  const { phone } = Route.useSearch();
  const { signIn, setMe } = useApp();
  const verify = useServerFn(verifyPhoneOtp);
  const resendCode = useServerFn(resendPhoneOtp);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(30);
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  function reset(next: Status) {
    setDigits(["", "", "", "", "", ""]);
    refs.current[0]?.focus();
    setStatus(next);
  }

  async function submit(code: string) {
    if (status === "loading" || code.length !== 6) return;
    setStatus("loading");
    try {
      const result = await verify({ data: { phone, code } });
      if (!result.ok) {
        reset(result.reason === "invalid" ? "invalid" : "expired");
        return;
      }
      const { error } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: result.tokenHash,
      });
      if (error) {
        reset("expired");
        return;
      }
      if (result.account.profileCompleted) {
        setMe({
          contactId: result.account.uniqueId,
          ...(result.account.username ? { username: result.account.username } : {}),
          ...(result.account.name ? { name: result.account.name } : {}),
        });
        signIn(phone);
        navigate({ to: "/home" });
      } else {
        navigate({ to: "/create-account", search: { phone } });
      }
    } catch {
      reset("expired");
    }
  }

  async function resend() {
    setStatus("idle");
    setDigits(["", "", "", "", "", ""]);
    const result = await resendCode({ data: { phone } });
    const wait = result.ok
      ? result.resendAfterSeconds
      : ((result as { retryAfterSeconds?: number }).retryAfterSeconds ?? 30);
    setSeconds(wait);
    refs.current[0]?.focus();
  }

  function setAt(i: number, value: string) {
    const next = [...digits];
    next[i] = value;
    setDigits(next);
    if (status === "invalid") setStatus("idle");
    if (value && i < 5) refs.current[i + 1]?.focus();
    if (next.every((d) => d)) submit(next.join(""));
  }

  const hasError = status === "invalid" || status === "expired";

  return (
    <main className="flex min-h-screen flex-col justify-center py-12">
      <Screen>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
          Verify your number
        </h1>
        <p className="mt-1.5 text-[12px] text-ink-2">
          We sent a 6-digit code on WhatsApp to {formatPhone(phone)}
        </p>

        <div className="mt-7 flex gap-2.5">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={d}
              inputMode="numeric"
              maxLength={1}
              disabled={status === "loading"}
              aria-label={`Digit ${i + 1}`}
              onChange={(e) => setAt(i, e.target.value.replace(/\D/g, "").slice(-1))}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
              }}
              onPaste={(e) => {
                const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
                if (text.length === 6) {
                  e.preventDefault();
                  setDigits(text.split(""));
                  submit(text);
                }
              }}
              className={`focus-blue h-[46px] w-[46px] rounded-[13px] border bg-surface text-center text-[16px] font-semibold text-ink shadow-soft outline-none transition-[border-color,box-shadow] ${
                hasError ? "border-red-400" : "border-line"
              }`}
            />
          ))}
        </div>

        {status === "invalid" && (
          <p className="mt-3 text-[12px] text-red-500">
            That code isn&apos;t right. Please try again.
          </p>
        )}
        {status === "expired" && (
          <p className="mt-3 text-[12px] text-red-500">That code has expired. Request a new one.</p>
        )}

        <div className="mt-6 flex items-center gap-4 text-[12px]">
          {seconds > 0 ? (
            <span className="text-ink-3">Resend code in 0:{String(seconds).padStart(2, "0")}</span>
          ) : (
            <button className="font-semibold text-ink" onClick={resend}>
              Resend code
            </button>
          )}
          <span className="h-3 w-px bg-line" />
          <button
            className="font-medium text-ink-2"
            onClick={() => {
              navigate({ to: "/login", search: phone ? { phone } : {} });
            }}
          >
            Change number
          </button>
        </div>

        <Button
          className="mt-8 w-full max-w-[330px]"
          disabled={status === "loading" || digits.some((d) => !d)}
          onClick={() => submit(digits.join(""))}
        >
          {status === "loading" ? <Loader2 size={16} className="animate-spin" /> : "Verify"}
        </Button>
      </Screen>
    </main>
  );
}
