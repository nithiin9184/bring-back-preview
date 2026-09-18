import { useEffect, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Camera, Check, MessageCircle, ScanLine, UserPlus, X } from "lucide-react";
import { Avatar, Screen } from "@/components/ui-kit";
import { useApp, key as handleKey } from "@/lib/store";
import { parseContactId, resolveContactId, type ContactIdentity } from "@/lib/identity/contact-id";

export const Route = createFileRoute("/contacts")({
  head: () => ({
    meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      { title: "Contacts — N Connect" },
      {
        name: "description",
        content: "Add an N Connect contact with their 7-digit Unique ID or by scanning their QR.",
      },
      { property: "og:title", content: "Contacts — N Connect" },
      {
        property: "og:description",
        content: "Find someone by Unique ID or QR and send a contact request.",
      },
    ],
  }),
  component: ContactsScreen,
});

const outlineBtn =
  "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[21px] border border-line bg-surface px-4 text-[13px] font-semibold text-ink shadow-soft transition-transform active:scale-[0.98]";
const blueBtn =
  "inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[21px] bg-brand px-4 text-[13px] font-semibold text-white transition-transform active:scale-[0.98]";

type DetectorLike = {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
};

function ContactsScreen() {
  const navigate = useNavigate();
  const {
    me,
    contacts,
    contactRequests,
    saveContact,
    resolveContactRequest,
    isBlocked,
    notify,
  } = useApp();
  const [digits, setDigits] = useState("");
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<ContactIdentity | null>(null);
  const [note, setNote] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  const incoming = contactRequests.filter((r) => r.direction === "incoming");
  const outgoing = contactRequests.filter((r) => r.direction === "outgoing");

  // Entering, pasting or scanning a complete 7-digit ID fetches automatically.
  const fetchId = async (id: string) => {
    if (me.contactId && id === me.contactId) {
      setFound(null);
      setNote("That's your own Unique ID");
      return;
    }
    const identity = await resolveContactId(id);
    // A blocked account can never be resolved by Unique ID or QR.
    if (!identity || isBlocked(identity.username)) {
      setFound(null);
      setNote(`No N Connect account found for ${id}`);
      return;
    }
    setNote("");
    setFound(identity);
    setScanning(false);
  };


  useEffect(() => {
    const id = parseContactId(digits);
    if (!id) {
      setFound(null);
      return;
    }
    void fetchId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const start = async () => {
      const Detector = (
        globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => DetectorLike }
      ).BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setNote("Camera scanning isn't supported here — enter the Unique ID instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        timer = setInterval(async () => {
          try {
            const hits = await detector.detect(video);
            const raw = hits[0]?.rawValue;
            if (!raw) return;
            const id = parseContactId(raw);
            if (!id) {
              setNote("That code isn't an N Connect QR");
              return;
            }
            setDigits(id);
            void fetchId(id);
          } catch {
            /* transient decode failure */
          }
        }, 400);
      } catch {
        setNote("Camera permission is needed to scan — enter the Unique ID instead.");
      }
    };
    void start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const addContact = () => {
    if (!found) return;
    // Saving only stores the person locally — nothing is sent to them.
    const result = saveContact({
      name: found.name ?? found.username,
      username: found.username,
      ...(found.contactId ? { contactId: found.contactId } : {}),
    });
    notify(result === "contact" ? "Already in your contacts" : "Saved to contacts");
    setFound(null);
    setDigits("");
  };


  return (
    <main className="min-h-screen pb-12 pt-[max(14px,env(safe-area-inset-top))]">
      <Screen>
        <header className="flex items-center justify-between">
          <button
            aria-label="Back"
            onClick={() => navigate({ to: "/chat" })}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
          >
            <ArrowLeft size={18} strokeWidth={1.8} />
          </button>
          <h1 className="text-[15px] font-semibold text-ink">Contacts</h1>
          <span className="h-9 w-9" />
        </header>

        <section
          className="glass mt-4 rounded-[26px] px-4 pb-5 pt-6"
          style={{ animation: "rise-in 420ms cubic-bezier(0.22,1,0.36,1) both" }}
        >
          <h2 className="text-center text-[15px] font-semibold text-ink">Add Contact</h2>
          <p className="mt-1 text-center text-[11.5px] text-ink-2">
            Enter their 7-digit Unique ID or scan their QR.
          </p>

          <div className="mt-4 flex items-center justify-center gap-2.5">
            <input
              value={digits}
              inputMode="numeric"
              maxLength={7}
              aria-label="7-digit Unique ID"
              onChange={(e) => {
                setNote("");
                setDigits(e.target.value.replace(/\D/g, "").slice(0, 7));
              }}
              placeholder="0000000"
              className="h-11 w-[168px] rounded-[23px] border border-line bg-surface text-center text-[17px] font-semibold tracking-[0.3em] text-ink shadow-soft outline-none placeholder:tracking-[0.3em] placeholder:text-ink-3 focus-blue"
            />
            <button
              aria-label={scanning ? "Stop scanning" : "Scan QR code"}
              onClick={() => {
                setNote("");
                setScanning((s) => !s);
              }}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border shadow-soft ${
                scanning ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink"
              }`}
            >
              {scanning ? <X size={16} strokeWidth={1.9} /> : <ScanLine size={16} strokeWidth={1.9} />}
            </button>
          </div>

          {scanning && (
            <div className="mt-4 overflow-hidden rounded-[22px] border border-line">
              <div className="relative aspect-square w-full bg-black/80">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                  aria-label="QR scanner"
                />
                <span className="pointer-events-none absolute inset-8 rounded-[22px] border-2 border-white/80" />
              </div>
              <p className="flex items-center justify-center gap-1.5 bg-surface px-4 py-3 text-[11.5px] text-ink-2">
                <Camera size={13} strokeWidth={1.9} />
                Point at an N Connect QR code
              </p>
            </div>
          )}

          {found && (
            <div
              className="mt-4 flex flex-col items-center rounded-[22px] border border-line bg-surface px-4 py-4 text-center shadow-soft"
              style={{ animation: "rise-in 260ms ease both" }}
            >
              <Avatar name={found.name ?? found.username} seed={found.contactId.length} size={56} />
              <p className="mt-2 text-[15px] font-semibold text-ink">
                {found.name ?? found.username}
              </p>
              <p className="mt-0.5 text-[12px] text-ink-2">
                {found.username} · {found.contactId}
              </p>
              <div className="mt-3 flex w-full gap-2.5">
                <button className={blueBtn} onClick={addContact}>
                  <UserPlus size={15} strokeWidth={1.9} />
                  Add Contact
                </button>
                <button
                  className={outlineBtn}
                  onClick={() => {
                    setFound(null);
                    setDigits("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {note && <p className="mt-3 text-center text-[11.5px] text-ink-2">{note}</p>}
        </section>

        {incoming.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[13px] font-semibold text-ink">Contact requests</h2>
            <ul className="mt-1 border-y border-line/70">
              {incoming.map((r) => (
                <li key={r.id} className="border-b border-line/60 py-3 last:border-b-0">
                  <div className="flex items-center gap-3">
                    <Avatar name={r.name} seed={r.name.length} size={42} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">
                        {r.name}
                      </span>
                      <span className="block truncate text-[11.5px] text-ink-2">
                        {r.username}
                        {r.contactId ? ` · ${r.contactId}` : ""}
                      </span>
                    </span>
                    <button
                      aria-label={`Delete request from ${r.name}`}
                      onClick={() => {
                        resolveContactRequest(r.id, "delete");
                        notify("Request deleted");
                      }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-ink-2"
                    >
                      <X size={15} strokeWidth={2.2} />
                    </button>
                  </div>
                  <div className="mt-2.5 flex gap-2.5">
                    <button
                      className={outlineBtn}
                      onClick={() => {
                        resolveContactRequest(r.id, "chat");
                        notify("Chat enabled");
                      }}
                    >
                      <Check size={15} strokeWidth={2.2} />
                      Accept Chat
                    </button>
                    <button
                      className={blueBtn}
                      onClick={() => {
                        resolveContactRequest(r.id, "contact");
                        notify("Contact added");
                      }}
                    >
                      <Check size={15} strokeWidth={2.2} />
                      Accept Contact
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {outgoing.length > 0 && (
          <section className="mt-6">
            <h2 className="text-[13px] font-semibold text-ink">Sent requests</h2>
            <ul className="mt-1 border-y border-line/70">
              {outgoing.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 border-b border-line/60 py-3 last:border-b-0"
                >
                  <Avatar name={r.name} seed={r.name.length} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {r.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-2">
                      Waiting for them to accept
                    </span>
                  </span>
                  <button
                    onClick={() => {
                      resolveContactRequest(r.id, "delete");
                      notify("Request withdrawn");
                    }}
                    className="h-8 shrink-0 rounded-full border border-line px-3 text-[12px] font-semibold text-ink-2"
                  >
                    Withdraw
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-6">
          <h2 className="text-[13px] font-semibold text-ink">Your contacts</h2>
          {contacts.length === 0 ? (
            <p className="mt-2 text-[12px] leading-[1.6] text-ink-2">
              No contacts yet. Add someone with their 7-digit Unique ID or QR code.
            </p>
          ) : (
            <ul className="mt-1 border-y border-line/70">
              {contacts.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 border-b border-line/60 py-3 last:border-b-0"
                >
                  <Avatar name={c.name} seed={c.name.length} size={42} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">
                      {c.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-ink-2">
                      {c.username}
                      {c.contactId ? ` · ${c.contactId}` : ""}
                    </span>
                  </span>
                  <button
                    aria-label={`Message ${c.name}`}
                    onClick={() =>
                      navigate({
                        to: "/chat/$username",
                        params: { username: handleKey(c.username) },
                      })
                    }
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink shadow-soft"
                  >
                    <MessageCircle size={15} strokeWidth={1.9} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Screen>
    </main>
  );
}
