import { expect, test } from "vitest";
import { sourceExcerpts } from "../lib/mcp/source-report";
import { presentReport } from "../lib/mcp/report-presentation";
test("source excerpts find distant terms without replacing source text or claiming complete coverage", () => {
  const source = "Lease notes\nOne reserved parking space.\n" + "Archived inspection: no change to lease terms.\n".repeat(1000) + "Landlord allows one indoor cat.\n";
  const result = sourceExcerpts(source, "lease parking cats");
  expect(result.excerpts.some(e => e.text.includes("parking space"))).toBe(true);
  expect(result.excerpts.some(e => e.text.includes("indoor cat"))).toBe(true);
  expect(result.excerpts.length).toBeLessThanOrEqual(6);
  expect(result.allMatchingLinesShown).toBe(false);
  for (const e of result.excerpts) expect(e.text).toBe(source.slice(e.start, e.end));
  const answer = presentReport({ reportType: "source_excerpts", queryComplete: true, items: [{ target: {kind:"arrangement",id:"lease"}, documentId:"doc", commit:"abc123", sourceLength:source.length, ...result }] });
  expect(answer).toContain("abc123");
  expect(answer).toContain("Selected excerpts only");
  expect(answer).toContain("do not establish that there are no other terms");
  expect(answer).toContain("indoor cat");
});
test("calendar rendering preserves the selected clock occurrence without model timezone conversions", () => {
  const answer = presentReport({ reportType: "events", filter: {}, coverage: "Complete matching recorded events", items: [{ id:"event", title:"Riley visit", date:"2026-11-01", time:"01:30", timezone:"America/Chicago", utcOffset:"UTC-06:00", clockOccurrence:"Second occurrence (UTC−06:00)", occurredAt:"2026-11-01T07:30:00.000Z" }] });
  expect(answer).toContain("Second occurrence (UTC−06:00)");
  expect(answer).toContain("2026-11-01T07:30:00.000Z");
  expect(answer).not.toContain("daylight-saving");
});
