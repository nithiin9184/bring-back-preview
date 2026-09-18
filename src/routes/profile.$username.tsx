import { createFileRoute, useParams } from "@tanstack/react-router";
import { ProfileView } from "@/components/ProfileView";
import { BottomNav } from "@/components/BottomNav";
import { Screen } from "@/components/ui-kit";
import { usePeerProfile } from "@/lib/profiles/profile-repository";

export const Route = createFileRoute("/profile/$username")({
  head: ({ params }) => {
    const name = `@${params.username.replace(/^@/, "")}`;
    return {
      meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { title: `${name} — N Connect` },
        {
          name: "description",
          content: "View a member's N Connect profile, bio and location.",
        },
        { property: "og:title", content: `${name} — N Connect` },
        { property: "og:description", content: "View a member's profile and location." },
      ],
    };
  },
  component: UserProfileScreen,
});

function UserProfileScreen() {
  const { username } = useParams({ from: "/profile/$username" });
  const { profile, loading } = usePeerProfile(username);

  if (loading) {
    return (
      <main className="min-h-screen pb-28 pt-[max(18px,env(safe-area-inset-top))]">
        <Screen>
          <p className="text-[12px] text-ink-2">Loading profile…</p>
        </Screen>
        <BottomNav />
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="min-h-screen pb-28 pt-[max(18px,env(safe-area-inset-top))]">
        <Screen>
          <h1 className="text-[18px] font-semibold text-ink">Profile unavailable</h1>
          <p className="mt-1 text-[12px] text-ink-2">
            We couldn't find @{username.replace(/^@/, "")} on N Connect.
          </p>
        </Screen>
        <BottomNav />
      </main>
    );
  }

  return (
    <>
      <ProfileView profile={profile} />
      <BottomNav />
    </>
  );
}
