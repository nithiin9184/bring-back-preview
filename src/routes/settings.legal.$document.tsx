import { createFileRoute } from "@tanstack/react-router";
import { SettingsShell } from "@/components/settings-kit";
import { LegalDocument } from "@/components/LegalDocument";
import { getLegalDoc } from "@/lib/legal/documents";

export const Route = createFileRoute("/settings/legal/$document")({
  head: ({ params }) => {
    const doc = getLegalDoc(params.document);
    const title = doc ? doc.title : "Legal & Policies";
    return {
      meta: [
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { title: `${title} — N Connect` },
        { name: "description", content: `${title} for N Connect.` },
        { property: "og:title", content: `${title} — N Connect` },
        { property: "og:description", content: `${title} for N Connect.` },
      ],
    };
  },
  component: LegalDocumentScreen,
});

function LegalDocumentScreen() {
  const { document: id } = Route.useParams();
  const doc = getLegalDoc(id);

  if (!doc) {
    return (
      <SettingsShell title="Not found">
        <p className="mt-10 text-center text-[13px] text-ink-2">This document doesn't exist.</p>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell title={doc.title} subtitle="Legal & Policies">
      <LegalDocument markdown={doc.markdown} />
    </SettingsShell>
  );
}
