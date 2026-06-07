import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const LIST_MARKER_RE = /^\s*(?:[-*+]\s+|\d+[.)、]\s+)/;
const HEADING_MARKER_RE = /^\s{0,3}#{1,6}\s+/;
const QUOTE_MARKER_RE = /^\s*>+\s?/;

export function RichMessageText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const lines = text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-1 list-disc space-y-1 pl-4">
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInline(cleanLine(item))}</li>
        ))}
      </ul>
    );
  };

  for (const rawLine of lines) {
    if (LIST_MARKER_RE.test(rawLine)) {
      listItems.push(rawLine.replace(LIST_MARKER_RE, ""));
      continue;
    }

    flushList();
    const isHeading = HEADING_MARKER_RE.test(rawLine);
    const isQuote = QUOTE_MARKER_RE.test(rawLine);
    const clean = cleanLine(rawLine);

    if (!clean) continue;

    if (isHeading) {
      blocks.push(
        <p key={`heading-${blocks.length}`} className="font-semibold text-foreground">
          {renderInline(clean)}
        </p>
      );
    } else if (isQuote) {
      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-2 border-primary/45 pl-3 text-muted-foreground"
        >
          {renderInline(clean)}
        </blockquote>
      );
    } else {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInline(clean)}</p>);
    }
  }

  flushList();

  return <div className={cn("space-y-1.5", className)}>{blocks}</div>;
}

export function stripMarkdownSyntax(text: string) {
  return text
    .replace(/\r/g, "")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^(\s{0,3})#{1,6}\s+/gm, "")
    .replace(/^\s*>+\s?/gm, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)、]\s+)/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/[*_`#]/g, "")
    .trim();
}

function cleanLine(line: string) {
  return stripMarkdownSyntax(line)
    .replace(LIST_MARKER_RE, "")
    .replace(HEADING_MARKER_RE, "")
    .replace(QUOTE_MARKER_RE, "")
    .trim();
}

function renderInline(text: string) {
  const normalized = text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1（$2）");
  const parts: ReactNode[] = [];
  const tokenRe = /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|`([^`\n]+)`|\*([^*\n]+)\*|_([^_\n]+)_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(normalized))) {
    pushPlain(parts, normalized.slice(lastIndex, match.index));
    const strong = match[2] ?? match[3];
    const code = match[4];
    const emphasis = match[5] ?? match[6];
    if (strong) {
      parts.push(
        <strong key={`strong-${parts.length}`} className="font-semibold text-foreground">
          {strong}
        </strong>
      );
    } else if (code) {
      parts.push(
        <code key={`code-${parts.length}`} className="rounded bg-secondary px-1 py-0.5 font-mono text-[0.92em]">
          {code}
        </code>
      );
    } else if (emphasis) {
      parts.push(
        <em key={`em-${parts.length}`} className="not-italic text-foreground">
          {emphasis}
        </em>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  pushPlain(parts, normalized.slice(lastIndex));
  return parts.length > 0 ? parts : stripMarkdownSyntax(normalized);
}

function pushPlain(parts: ReactNode[], text: string) {
  const clean = text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#]/g, "");
  if (clean.length > 0) parts.push(clean);
}
