import termsMd from "@/content/legal/NConnect_Terms_and_Conditions.md?raw";
import privacyMd from "@/content/legal/NConnect_Privacy_Policy.md?raw";
import safetyMd from "@/content/legal/NConnect_Safety_Community_Reporting_Policy.md?raw";

export type LegalDocId = "terms" | "privacy" | "safety";

export type LegalDoc = {
  id: LegalDocId;
  title: string;
  note: string;
  markdown: string;
};

export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    id: "terms",
    title: "Terms & Conditions",
    note: "Your agreement for using N Connect",
    markdown: termsMd,
  },
  {
    id: "privacy",
    title: "Privacy Policy",
    note: "How your information is handled",
    markdown: privacyMd,
  },
  {
    id: "safety",
    title: "Safety, Community & Reporting",
    note: "Community standards and reporting",
    markdown: safetyMd,
  },
] as const;

export function getLegalDoc(id: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.id === id);
}
