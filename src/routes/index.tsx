import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { NConnectLogo } from "@/components/NConnectLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "N Connect — Private, End-to-End Encrypted Messaging" },
      {
        name: "description",
        content:
          "N Connect is a minimal, end-to-end encrypted way to find people nearby and chat privately.",
      },
      { property: "og:title", content: "N Connect — Private, Encrypted Messaging" },
      {
        property: "og:description",
        content: "Find people nearby and chat privately with end-to-end encryption.",
      },
    ],
  }),
  component: Splash,
});

function Splash() {
  const navigate = useNavigate();
  const { ready, signedIn } = useApp();

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => navigate({ to: signedIn ? "/home" : "/login" }), 3000);
    return () => clearTimeout(t);
  }, [navigate, ready, signedIn]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4">
      <div
        style={{ animation: "rise-in 1100ms cubic-bezier(0.22,1,0.36,1) both" }}
        className="flex flex-col items-center text-center"
      >
        <h1 className="sr-only">N Connect</h1>
        <NConnectLogo size={168} />
        <p className="mt-3 text-[12px] font-normal tracking-[0.06em] text-ink-2">
          End-to-End Encrypted
        </p>
      </div>
    </main>
  );
}
