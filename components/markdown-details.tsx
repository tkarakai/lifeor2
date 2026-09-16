import { Fragment, type ReactNode } from "react";
import { parseDetails } from "../lib/details/frontmatter";

function safeLink(url: string) {
  return /^(?:https?:\/\/|mailto:)/i.test(url) || /^\/(?!\/)/.test(url) || /^#[A-Za-z0-9_-]+$/.test(url);
}
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^\s)]+\))/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(([^\s)]+)\)$/.exec(part);
    if (link && safeLink(link[2])) return <a key={i} href={link[2]} rel="noopener noreferrer" className="underline underline-offset-4">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** A safe, intentionally small Markdown subset. HTML/MDX is always escaped text. */
export function MarkdownDetails({ source, className = "" }: { source: string; className?: string }) {
  const parsed = parseDetails(source);
  const lines = parsed.body.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<pre key={i} className="overflow-x-auto rounded-md bg-muted p-4 text-xs"><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      blocks.push(<Tag key={i} className={heading[1].length < 3 ? "text-xl font-semibold tracking-tight" : "font-semibold"}>{inline(heading[2])}</Tag>);
      i++; continue;
    }
    if (/^[-*] /.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^[-*] /.test(lines[i])) { items.push(<li key={i}>{inline(lines[i].slice(2))}</li>); i++; }
      blocks.push(<ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>); continue;
    }
    if (/^> /.test(line)) { blocks.push(<blockquote key={i} className="border-l-2 pl-4 text-muted-foreground">{inline(line.slice(2))}</blockquote>); i++; continue; }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(?:#{1,6}\s|```|[-*] |> )/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push(<p key={i} className="whitespace-pre-wrap break-words leading-7">{inline(paragraph.join("\n"))}</p>);
  }
  return <div className={`space-y-4 text-sm ${className}`}>
    {parsed.diagnostic && <p role="status" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">{parsed.diagnostic}</p>}
    {Object.keys(parsed.metadata).length > 0 && <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-1 border-b pb-4 text-xs">
      {Object.entries(parsed.metadata).map(([key, value]) => <Fragment key={key}><dt className="font-medium text-muted-foreground">{key}</dt><dd className="break-words">{value === null ? "null" : String(value)}</dd></Fragment>)}
    </dl>}
    {blocks.length ? blocks : <p className="text-muted-foreground italic">Empty document.</p>}
  </div>;
}
