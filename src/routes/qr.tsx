import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { QrCanvas } from "@/components/QrCanvas";
import { useApp } from "@/lib/store";
import { contactIdQrPayload } from "@/lib/identity/contact-id";

export const Route = createFileRoute("/qr")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "My QR Code — N Connect" },
      {
        name: "description",
        content: "Your personal N Connect QR code, carrying only your permanent Unique ID.",
      },
      { property: "og:title", content: "My QR Code — N Connect" },
      { property: "og:description", content: "Share your N Connect Unique ID with a QR code." },
    ],
  }),
  component: QrScreen,
});

function QrScreen() {
  const navigate = useNavigate();
  const { me } = useApp();

  return (
    <main className="min-h-screen pb-12 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center justify-between">
          <button
            aria-label="Back"
            onClick={() => navigate({ to: "/profile" })}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            <ArrowLeft size={18} strokeWidth={1.8} />
          </button>
          <h1 className="text-[15px] font-semibold text-ink">My QR Code</h1>
          <span className="h-9 w-9" />
        </header>

        <section
          className="glass mt-4 rounded-[26px] px-4 pb-5 pt-6"
          style={{ animation: "rise-in 420ms cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <div className="flex flex-col items-center text-center">
            <Avatar
              name={me.name}
              seed={me.name.length}
              size={64}
              photo={me.photo}
              className="ring-2 ring-white/90 shadow-[0_8px_26px_-16px_rgb(0_0_0/0.45)]"
            />
            <p className="mt-2.5 text-[16px] font-semibold tracking-[-0.01em] text-ink">
              {me.name}
            </p>
            <p className="mt-1 text-[12px] text-ink-2">
              {me.username}
              {me.contactId ? ` · ${me.contactId}` : ""}
            </p>

            <div className="mt-5 grid place-items-center rounded-[22px] border border-line bg-surface p-4 shadow-soft">
              {me.contactId ? (
                <QrCanvas value={contactIdQrPayload(me.contactId)} />
              ) : (
                <p className="max-w-[200px] py-16 text-[12px] text-ink-2">
                  Your Unique ID appears once your account is created.
                </p>
              )}
            </div>
            <p className="mt-3 max-w-[260px] text-[11px] leading-[1.5] text-ink-3">
              This code shares only your permanent Unique ID. Your phone number is never included.
            </p>
          </div>
        </section>
      </Screen>
    </main>
  );
}
