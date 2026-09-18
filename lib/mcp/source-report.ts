import { queryTerms } from "../../convex/lib/lifeQueries/text";
import { saveReport } from "./report-store";
/** Rank matching source lines by distinctive words, preserving exact source offsets. */
export function sourceExcerpts(source: string, query: string) {
  const terms = new Set(queryTerms(query));
  if (!terms.size || terms.size > 16) throw new Error("Use 1–16 distinctive source-search words");
  const lines: { start: number; end: number; terms: string[] }[] = [];
  const counts = new Map<string, number>();
  let offset = 0;
  for (const line of source.split("\n")) {
    const matched = queryTerms(line).filter(t => terms.has(t));
    if (matched.length) {
      lines.push({ start: offset, end: offset + line.length, terms: matched });
      for (const term of matched) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    offset += line.length + 1;
  }
  const score = (line: typeof lines[number]) => line.terms.reduce((sum, t) => sum + 1 / Math.log2(2 + counts.get(t)!), 0);
  const selected = lines.sort((a, b) => score(b) - score(a) || a.start - b.start).slice(0, 6).sort((a, b) => a.start - b.start);
  const excerpts = selected.map(line => {
    const body = source.slice(line.start, line.end);
    const match = [...body.matchAll(/[\p{L}\p{N}]+/gu)].find(m => queryTerms(m[0]).some(t => terms.has(t)));
    const start = line.end - line.start <= 600 ? line.start : Math.max(line.start, line.start + (match?.index ?? 0) - 120);
    const end = Math.min(line.end, start + 600);
    return { start, end, text: source.slice(start, end) };
  });
  return { excerpts, matchingLineCount: lines.length, allMatchingLinesShown: selected.length === lines.length && selected.every((l, i) => l.start === excerpts[i].start && l.end === excerpts[i].end) };
}
export async function sourceReport(scope: { userId: string; connectionId: string; datasetId: string }, data: Record<string, any>) {
  if (!data.items.length) return data;
  const full = { ...data, reportType: "source_excerpts", items: data.items as Record<string, any>[] };
  const saved = await saveReport(scope, full);
  return { ...full, ...saved, items: full.items.slice(0, 4), previewOnly: full.items.length > 4, hint: "Present this saved report when its source lines answer the requested fact. A word match alone may be related but insufficient evidence. If needed, try one focused synonymous query. If the fact is still not established, present with conclusion=insufficient_evidence; do not substitute a related fact, guess possible values as search terms, or exhaustively page unrelated text. Exact commits and excerpt coverage are included; do not infer unshown text." };
}
