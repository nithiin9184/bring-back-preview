import { Link } from "@tanstack/react-router";
import { Home, CircleDashed, Users, MessageCircle, Settings } from "lucide-react";

const items = [
  { to: "/home", label: "Home", Icon: Home },
  { to: "/chat", label: "Chat", Icon: MessageCircle },
  { to: "/status", label: "Status", Icon: CircleDashed },
  { to: "/connect", label: "Connect", Icon: Users },
  { to: "/settings", label: "Settings", Icon: Settings },
] as const;

export function BottomNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-[430px] px-3 pb-2">
        <div className="glass bottom-nav-outline grid h-16 grid-cols-5 items-stretch rounded-xl px-1">
          {items.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              className="group relative flex min-w-0 flex-col items-center justify-center gap-1 text-ink-3 transition-colors data-[status=active]:text-ink"
            >
              <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-transparent group-data-[status=active]:bg-ink" />
              <Icon
                size={20}
                strokeWidth={1.8}
              />
              <span className="text-[10px] font-medium leading-3">{label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
