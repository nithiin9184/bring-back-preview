import type { ReactNode } from "react";

/**
 * Minimal reader for the supplied legal markdown documents.
 * It only formats the text — no content is added, removed or rewritten.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** while keeping everything else verbatim.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      nodes.push(
        <strong key={`${keyBase}-b${i}`} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(part);
    }
  });
  return nodes;
}

function softBreakLines(block: string, keyBase: string): ReactNode[] {
  const lines = block.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    out.push(...inline(line.replace(/\s+$/, ""), `${keyBase}-l${i}`));
    if (i < lines.length - 1) out.push(<br key={`${keyBase}-br${i}`} />);
  });
  return out;
}

export function LegalDocument({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const k = `p${key++}`;
    blocks.push(
      <p key={k} className="mt-4 text-[14.5px] leading-[1.75] text-ink-2">
        {softBreakLines(paragraph.join("\n"), k)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    const k = `ul${key++}`;
    blocks.push(
      <ul key={k} className="mt-3 space-y-2 pl-1">
        {list.map((item, i) => (
          <li key={`${k}-${i}`} className="flex gap-2.5 text-[14.5px] leading-[1.75] text-ink-2">
            <span aria-hidden className="mt-[9px] h-[4px] w-[4px] shrink-0 rounded-full bg-ink-3" />
            <span className="min-w-0 flex-1">{inline(item, `${k}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    const k = `bq${key++}`;
    blocks.push(
      <blockquote
        key={k}
        className="mt-5 border-l-2 border-line pl-4 text-[13.5px] leading-[1.7] text-ink-2"
      >
        {softBreakLines(quote.join("\n"), k)}
      </blockquote>,
    );
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const raw of lines) {
    const line = raw;
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    if (trimmed.startsWith("### ")) {
      flushAll();
      blocks.push(
        <h3
          key={`h3${key++}`}
          className="mt-7 text-[14px] font-semibold leading-6 tracking-[-0.005em] text-ink"
        >
          {inline(trimmed.slice(4), `h3${key}`)}
        </h3>,
      );
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushAll();
      blocks.push(
        <h2
          key={`h2${key++}`}
          className="mt-9 text-[16px] font-semibold leading-6 tracking-[-0.01em] text-ink"
        >
          {inline(trimmed.slice(3), `h2${key}`)}
        </h2>,
      );
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushAll();
      blocks.push(
        <h1
          key={`h1${key++}`}
          className="mt-2 text-[20px] font-semibold leading-7 tracking-[-0.015em] text-ink"
        >
          {inline(trimmed.slice(2), `h1${key}`)}
        </h1>,
      );
      continue;
    }
    if (trimmed.startsWith("> ")) {
      flushParagraph();
      flushList();
      quote.push(trimmed.slice(2));
      continue;
    }
    if (trimmed.startsWith("- ")) {
      flushParagraph();
      flushQuote();
      list.push(trimmed.slice(2));
      continue;
    }

    flushList();
    flushQuote();
    paragraph.push(line);
  }

  flushAll();

  return <article className="mx-auto max-w-[70ch] pb-4">{blocks}</article>;
}
