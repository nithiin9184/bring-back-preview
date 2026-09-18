import { useState } from "react";
import { MessageCircle, Plus, UserMinus, UserRound, UsersRound } from "lucide-react";
import { Avatar } from "@/components/ui-kit";
import { GlassSheet } from "@/components/GlassSheet";
import { StatusRing } from "@/components/status/StatusRing";
import { useApp } from "@/lib/store";

type GreetingMember = { id: string; name: string; username?: string };
type MemberSource = "Followers" | "Following" | "Chats";

const slotCount = 5;

export function GreetingCard({ greeting }: { greeting: string }) {
  const { statusRing } = useApp();
  const [members, setMembers] = useState<GreetingMember[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [source, setSource] = useState<MemberSource | null>(null);
  const [removing, setRemoving] = useState<GreetingMember | null>(null);
  const emptySlots = Math.max(0, slotCount - members.length);

  return (
    <>
      <section className="greeting-depth glass relative mt-5 overflow-hidden rounded-[22px] px-4 py-3.5">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-surface/90"
        />
        <p className="relative text-[14px] font-semibold text-ink">{greeting}</p>
        <div className="relative mt-3.5 grid grid-cols-5 gap-2">
          {members.map((member, index) => (
            <button
              key={member.id}
              type="button"
              onClick={() => setRemoving(member)}
              className="flex min-w-0 flex-col items-center gap-1.5"
              aria-label={`Remove ${member.name}`}
            >
              <StatusRing state={member.username ? statusRing(member.username) : null} size={42}>
                <Avatar
                  name={member.name}
                  seed={index}
                  size={member.username && statusRing(member.username) ? 36 : 42}
                  className="shadow-soft ring-1 ring-surface/90"
                />
              </StatusRing>
              <span className="w-full truncate text-center text-[10px] text-ink-2">
                {member.name}
              </span>
            </button>
          ))}
          {Array.from({ length: emptySlots }, (_, index) => (
            <button
              key={`empty-${index}`}
              type="button"
              onClick={() => setSelecting(true)}
              className="flex min-w-0 flex-col items-center gap-1.5"
              aria-label="Add member"
            >
              <span className="grid h-[42px] w-[42px] place-items-center rounded-full border border-surface/80 bg-surface/70 text-ink-2 shadow-soft">
                <Plus size={16} strokeWidth={2} />
              </span>
              <span className="text-[10px] text-ink-3">+ Add</span>
            </button>
          ))}
        </div>
      </section>

      <GlassSheet
        open={selecting}
        title="Add from"
        onClose={() => setSelecting(false)}
        actions={[
          { label: "Followers", Icon: UserRound, onSelect: () => setSource("Followers") },
          { label: "Following", Icon: UsersRound, onSelect: () => setSource("Following") },
          { label: "Chat", Icon: MessageCircle, onSelect: () => setSource("Chats") },
        ]}
      />

      <GlassSheet
        open={Boolean(source)}
        title={source ?? undefined}
        onClose={() => setSource(null)}
      >
        <p className="px-3 py-5 text-center text-[12px] text-ink-2">No people available yet.</p>
      </GlassSheet>

      <GlassSheet
        open={Boolean(removing)}
        title={removing ? `Remove ${removing.name}?` : undefined}
        onClose={() => setRemoving(null)}
        actions={[
          {
            label: "Remove member",
            Icon: UserMinus,
            tone: "danger",
            onSelect: () => {
              if (removing)
                setMembers((current) => current.filter((member) => member.id !== removing.id));
            },
          },
          { label: "Cancel" },
        ]}
      />
    </>
  );
}
