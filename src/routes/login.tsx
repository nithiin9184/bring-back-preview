import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button, Label, Screen } from "@/components/ui-kit";
import { PhoneField } from "@/components/PhoneField";
import { requestPhoneOtp } from "@/lib/auth/phone-auth.functions";
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  toE164,
  validateNationalNumber,
  type Country,
} from "@/lib/auth/countries";
import { useServerFn } from "@tanstack/react-start";
import { NConnectLogo } from "@/components/NConnectLogo";

type Search = { phone?: string };

/** Splits a stored E.164 number back into a country and its national part. */
function splitPhone(e164: string): { country: Country; national: string } {
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => e164.startsWith(c.dial));
  if (!match) return { country: DEFAULT_COUNTRY, national: e164.replace(/\D/g, "") };
  return { country: match, national: e164.slice(match.dial.length).replace(/\D/g, "") };
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search["phone"] === "string" && search["phone"] ? { phone: search["phone"] } : {},
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Log in — N Connect" },
      {
        name: "description",
        content: "Log in to N Connect with your mobile number to continue your encrypted chats.",
      },
      { property: "og:title", content: "Log in — N Connect" },
      { property: "og:description", content: "Log in with your mobile number to continue." },
    ],
  }),
  component: LoginScreen,
});

function LoginScreen() {
  const navigate = useNavigate();
  const sendOtp = useServerFn(requestPhoneOtp);
  const prefill = Route.useSearch().phone;
  const initial = splitPhone(prefill ?? "");
  const [country, setCountry] = useState<Country>(initial.country);
  const [number, setNumber] = useState(initial.national);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const numberInput = useRef<HTMLInputElement | null>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const problem = validateNationalNumber(country, number);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setLoading(true);
    const phone = toE164(country, number);
    try {
      const result = await sendOtp({ data: { phone } });
      if (!result.ok) {
        if (result.reason === "cooldown" && result.retryAfterSeconds) {
          setError(`Please wait ${result.retryAfterSeconds}s before requesting another code.`);
        } else if (result.reason === "rate_limited") {
          setError("Too many codes requested. Please try again later.");
        } else if (result.reason === "invalid_phone") {
          setError("Enter a valid mobile number.");
        } else {
          setError("Couldn't send the code. Please try again.");
        }
        return;
      }
      navigate({ to: "/verify", search: { phone } });
    } catch {
      setError("Couldn't send the code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center py-12">
      <Screen>
        <div className="flex flex-col items-center text-center">
          <h1 className="sr-only">N Connect</h1>
          <NConnectLogo size={124} />
          <p className="mt-2 text-[12px] text-ink-2">Welcome back. Sign in with your number.</p>
        </div>

        <form className="mt-8 flex flex-col items-center gap-4" onSubmit={submit}>
          <div className="w-full max-w-[330px]">
            <Label>Mobile number</Label>
            <PhoneField
              country={country}
              onCountryChange={(c) => {
                setCountry(c);
                setError(null);
              }}
              value={number}
              onValueChange={(v) => {
                setNumber(v);
                setError(null);
              }}
              invalid={Boolean(error)}
              disabled={loading}
              inputRef={numberInput}
            />
            {error ? (
              <p className="mt-2 pl-1 text-[12px] text-red-500">{error}</p>
            ) : (
              <p className="mt-2 pl-1 text-[12px] text-ink-3">
                We&apos;ll send a 6-digit code to this number.
              </p>
            )}
          </div>

          <Button type="submit" disabled={loading} className="mt-1 w-full max-w-[330px]">
            {loading ? <Loader2 size={16} className="animate-spin" /> : "Send OTP"}
          </Button>

          <p className="pt-1 text-[12px] text-ink-2">
            New here?{" "}
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                if (validateNationalNumber(country, number)) {
                  setError(null);
                  numberInput.current?.focus();
                  return;
                }
                void submit();
              }}
              className="font-semibold text-ink underline underline-offset-2 disabled:opacity-60"
            >
              Continue with your number
            </button>{" "}
            to create an account.
          </p>
        </form>
      </Screen>
    </main>
  );
}
