import { createFileRoute } from "@tanstack/react-router";
import { ProfileView } from "@/components/ProfileView";
import { BottomNav } from "@/components/BottomNav";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/profile/")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Your Profile — N Connect" },
      {
        name: "description",
        content: "Your N Connect profile: bio, followers, following and profile likes.",
      },
      { property: "og:title", content: "Your Profile — N Connect" },
      { property: "og:description", content: "Your bio, followers, following and profile likes." },
    ],
  }),
  component: OwnProfile,
});

function OwnProfile() {
  const { me } = useApp();
  return (
    <>
      <ProfileView profile={me} own />
      <BottomNav />
    </>
  );
}
