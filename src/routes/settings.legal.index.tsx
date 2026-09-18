import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileText, ScrollText, ShieldCheck } from "lucide-react";
import { ActionRow, Group, InfoNote, SettingsShell } from "@/components/settings-kit";
import { LEGAL_DOCS, type LegalDocId } from "@/lib/legal/documents";

export const Route = createFileRoute("/settings/legal/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Legal & Policies — N Connect Settings" },
      {
        name: "description",
        content: "Read the N Connect Terms & Conditions, Privacy Policy and Safety policy.",
      },
      { property: "og:title", content: "Legal & Policies — N Connect Settings" },
      {
        property: "og:description",
        content: "Terms & Conditions, Privacy Policy and Safety, Community & Reporting.",
      },
    ],
  }),
  component: LegalIndexScreen,
});

const icons: Record<LegalDocId, typeof FileText> = {
  terms: ScrollText,
  privacy: FileText,
  safety: ShieldCheck,
};

function LegalIndexScreen() {
  const navigate = useNavigate();
  return (
    <SettingsShell title="Legal & Policies" subtitle="Terms, privacy and safety">
      <Group>
        {LEGAL_DOCS.map((doc) => (
          <ActionRow
            key={doc.id}
            Icon={icons[doc.id]}
            title={doc.title}
            note={doc.note}
            onSelect={() =>
              navigate({ to: "/settings/legal/$document", params: { document: doc.id } })
            }
          />
        ))}
      </Group>
      <InfoNote>These documents apply to your use of N Connect.</InfoNote>
    </SettingsShell>
  );
}
