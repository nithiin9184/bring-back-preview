import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Camera, ChevronLeft, Check } from "lucide-react";
import { Avatar, Button, Field, Label, Screen } from "@/components/ui-kit";
import { formatPhone } from "@/lib/auth/countries";
import { normalizeUsername } from "@/lib/username/username-service";
import { useUsernameAvailability } from "@/lib/username/use-username-availability";
import { useApp } from "@/lib/store";
import { ImageAdjuster } from "@/components/ImageAdjuster";
import { useServerFn } from "@tanstack/react-start";
import { completePhoneProfile } from "@/lib/auth/phone-auth.functions";

type Search = { phone: string };

export const Route = createFileRoute("/create-account")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    phone: typeof search["phone"] === "string" ? search["phone"] : "",
  }),
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Create account — N Connect" },
      {
        name: "description",
        content: "Create your N Connect account and start private, encrypted chats.",
      },
      { property: "og:title", content: "Create account — N Connect" },
      { property: "og:description", content: "Create your N Connect account in a minute." },
    ],
  }),
  component: CreateAccount,
});

function CreateAccount() {
  const navigate = useNavigate();
  const { phone } = Route.useSearch();
  const { createAccount } = useApp();
  const completeProfile = useServerFn(completePhoneProfile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [type, setType] = useState<"public" | "private">("public");
  const [agree, setAgree] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [photo, setPhoto] = useState("");
  const [raw, setRaw] = useState("");
  const [village, setVillage] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pin, setPin] = useState("");
  const photoInput = useRef<HTMLInputElement | null>(null);
  const { status: usernameStatus, error: usernameError } = useUsernameAvailability(username);
  const usernameOk = usernameStatus === "available";

  useEffect(() => {
    if (!phone) navigate({ to: "/login" });
  }, [phone, navigate]);

  // Picking an image opens the adjust/crop step before it becomes the photo.
  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setRaw(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className="min-h-screen pb-14 pt-[max(20px,env(safe-area-inset-top))]">
      <Screen className="px-6">
        <div className="w-full">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate({ to: "/login" })}
              aria-label="Back"
              className="grid h-9 w-9 place-items-center rounded-full text-ink"
            >
              <ChevronLeft size={20} strokeWidth={1.9} />
            </button>
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
              Create Account
            </h1>
          </div>

          <div className="mt-6 flex justify-center">
            <div className="relative">
              {photo ? (
                <Avatar name={name} photo={photo} size={82} className="shadow-soft" />
              ) : (
                <div className="grid h-[82px] w-[82px] place-items-center rounded-full border border-line bg-surface text-[12px] text-ink-3 shadow-soft">
                  Photo
                </div>
              )}
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                aria-label="Add profile photo"
                className="absolute -bottom-0.5 -right-0.5 grid h-7 w-7 place-items-center rounded-full border border-white bg-ink text-background"
              >
                <Camera size={13} strokeWidth={2} />
              </button>
            </div>
          </div>

          {raw && (
            <ImageAdjuster
              src={raw}
              onCancel={() => setRaw("")}
              onSave={(next) => {
                setRaw("");
                setPhoto(next);
              }}
            />
          )}

          <form
            className="mt-7 flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!agree || !usernameOk || saving) return;
              const handle = normalizeUsername(username);
              setSaving(true);
              setSaveError(null);
              try {
                const result = await completeProfile({
                  data: { name: name.trim(), username: handle },
                });
                if (!result.ok) {
                  setSaveError(
                    result.reason === "username_taken"
                      ? "That username was just taken. Please choose another."
                      : "Couldn't create your account. Please try again.",
                  );
                  return;
                }
                // Username uniqueness is owned by the database; the server call
                // above already reported a taken handle.
                const location = [village.trim(), city.trim(), stateName.trim()]
                  .filter(Boolean)
                  .join(", ");
                createAccount({
                  profile: {
                    name: name.trim(),
                    username: `@${handle}`,
                    photo,
                    location,
                    village: village.trim(),
                    city: city.trim(),
                    state: stateName.trim(),
                    pin: pin.trim(),
                  },
                  phone,
                  private: type === "private",
                  contactId: result.account.uniqueId,
                });
                navigate({ to: "/home" });
              } catch {
                setSaveError("Couldn't create your account. Please try again.");
              } finally {
                setSaving(false);
              }
            }}
          >
            <div>
              <Label>Full Name</Label>
              <Field
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your full name"
              />
            </div>

            <div>
              <Label>Username</Label>
              <div className="relative">
                <Field
                  value={username}
                  onChange={(e) => setUsername(normalizeUsername(e.target.value))}
                  placeholder="Choose a username"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="pr-[104px]"
                  aria-invalid={usernameStatus === "invalid" || usernameStatus === "taken"}
                />
              </div>
              {usernameStatus !== "idle" && (
                <p
                  aria-live="polite"
                  className={`mt-1.5 pl-1 text-[12px] ${
                    usernameStatus === "available"
                      ? "text-brand"
                      : usernameStatus === "checking"
                        ? "text-ink-3"
                        : "text-red-500"
                  }`}
                >
                  {usernameStatus === "checking" && "Checking…"}
                  {usernameStatus === "available" && "✓ Username available"}
                  {usernameStatus === "taken" && "✕ Username already taken"}
                  {usernameStatus === "invalid" && usernameError}
                  {usernameStatus === "error" && "Couldn't check right now — try again"}
                </p>
              )}
            </div>

            <div className="w-[230px]">
              <Label>Number</Label>
              <div className="flex h-11 items-center gap-2 rounded-[23px] border border-line bg-surface px-4 shadow-soft">
                <span className="text-[14px] text-ink">{formatPhone(phone)}</span>
                <Check size={14} strokeWidth={2.4} className="text-brand" aria-hidden />
                <span className="sr-only">Verified</span>
              </div>
              <p className="mt-1.5 pl-1 text-[12px] text-ink-3">Verified number</p>
            </div>

            <div>
              <Label>Village / Locality (Optional)</Label>
              <Field
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="Village or locality"
              />
            </div>

            <div className="flex gap-3.5">
              <div className="flex-1">
                <Label>City</Label>
                <Field value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
              </div>
              <div className="flex-1">
                <Label>State</Label>
                <Field
                  value={stateName}
                  onChange={(e) => setStateName(e.target.value)}
                  placeholder="State"
                />
              </div>
            </div>

            <div className="w-[140px]">
              <Label>PIN Code</Label>
              <Field
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="PIN code"
                inputMode="numeric"
                maxLength={6}
              />
            </div>

            <div className="mt-1">
              <Label>Account type</Label>
              <div className="inline-flex rounded-[22px] border border-line bg-surface p-1 shadow-soft">
                {(["public", "private"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    className={`h-9 rounded-[18px] px-6 text-[13px] font-semibold capitalize transition-colors ${
                      type === t ? "bg-brand text-white" : "text-ink-3"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <label className="mt-1 flex items-start gap-2.5 text-[12px] leading-relaxed text-ink-2">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="mt-0.5 h-[15px] w-[15px] shrink-0 rounded-[5px] border border-line accent-black"
              />
              <span>
                I agree to the <span className="font-medium text-ink">Terms &amp; Conditions</span>{" "}
                and Privacy Policy.
              </span>
            </label>

            {saveError && <p className="pl-1 text-[12px] text-red-500">{saveError}</p>}

            <Button
              type="submit"
              disabled={!agree || !usernameOk || saving}
              className="mt-2 w-full"
            >
              {saving ? "Creating…" : "Create Account"}
            </Button>
          </form>
        </div>
      </Screen>
    </main>
  );
}
