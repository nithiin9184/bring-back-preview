import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Avatar } from "@/components/ui-kit";
import { useApp, key as handleKey } from "@/lib/store";
import type { Person } from "@/data/types";

function PersonItem({ person, index }: { person: Person; index: number }) {
  const navigate = useNavigate();
  const { relationOf, setRelation, notify } = useApp();
  const state = relationOf(person.username);

  return (
    <div className="flex w-28 shrink-0 flex-col items-center text-center">
      <button
        onClick={() =>
          navigate({ to: "/profile/$username", params: { username: handleKey(person.username) } })
        }
        className="flex w-full flex-col items-center"
      >
        <Avatar name={person.name} seed={index} size={48} />
        <span className="mt-2 w-full truncate text-xs font-semibold leading-4 text-ink">
          {person.name}
        </span>
        <span className="w-full truncate text-[11px] leading-4 text-ink-2">{person.username}</span>
        <span className="w-full truncate text-[11px] leading-4 text-ink-3">{person.location}</span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          const next = state === "follow" ? "following" : "follow";
          setRelation(person.username, next);
          notify(next === "following" ? `Following ${person.name}` : `Unfollowed ${person.name}`);
        }}
        className={`mt-2 h-8 rounded-lg px-3 text-xs font-semibold ${
          state === "follow" ? "bg-brand text-background" : "bg-muted text-ink-2"
        }`}
      >
        {state === "follow" ? "Follow" : state === "requested" ? "Requested" : "Following"}
      </button>
    </div>
  );
}

export function PeopleStrip({ people = [] }: { people?: Person[] }) {
  const [paused, setPaused] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hold = () => {
    if (timer.current) clearTimeout(timer.current);
    setPaused(true);
  };
  const release = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPaused(false), 2500);
  };

  if (people.length === 0) return null;

  return (
    <div
      className="overflow-hidden"
      onPointerDown={hold}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
    >
      <div
        className="flex w-max gap-2 px-4 sm:px-5"
        style={{
          animation: "marquee 140s linear infinite",
          animationPlayState: paused ? "paused" : "running",
        }}
      >
        {[...people, ...people].map((p, i) => (
          <PersonItem key={`${p.id}-${i}`} person={p} index={i} />
        ))}
      </div>
    </div>
  );
}
