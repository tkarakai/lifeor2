import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { consistentQuery = mocks.query; } }));
vi.mock("../lib/mcp/report-store", () => ({ saveReport: mocks.save }));
import { eventReport, eventChangeReport } from "../lib/mcp/event-report";
const scope = {userId:"user",connectionId:"connection",datasetId:"dataset"};
test("event reports consume empty filtered pages before saving complete calendar evidence", async () => {
  mocks.query.mockReset();mocks.save.mockReset().mockResolvedValue({reportId:"saved"});
  mocks.query.mockResolvedValueOnce({items:[],nextCursor:"more",queryComplete:false,filter:{query:"dentist"}}).mockResolvedValueOnce({items:[{id:"next",date:"2027-01-12"}],nextCursor:null,queryComplete:true});
  const result = await eventReport({url:"http://isolated"} as any,"token",scope,{query:"dentist"});
  expect(result).toMatchObject({reportId:"saved",reportType:"events",items:[{id:"next"}],queryComplete:true,nextCursor:null});
  expect(mocks.query.mock.calls[1][1].cursor).toBe("more");
  expect(mocks.save).toHaveBeenCalledTimes(1);
});
test("an incomplete event scan cannot save or present partial evidence as complete", async () => {
  mocks.query.mockReset();mocks.save.mockReset();
  mocks.query.mockResolvedValueOnce({items:[{id:"one"}],nextCursor:"more",queryComplete:false}).mockRejectedValueOnce(new Error("snapshot expired"));
  await expect(eventReport({url:"http://isolated"} as any,"token",scope,{})).rejects.toThrow("snapshot expired");
  expect(mocks.save).not.toHaveBeenCalled();
});


test("calendar writes save fresh receipts and keep committed success if optional storage fails", async () => {
  const committed = { id: "saved-event", status: "recorded", title: "Visit", date: "2026-09-19", time: "10:30", timezone: "America/Chicago", utcOffset: "UTC-05:00", occurredAt: "2026-09-19T15:30:00.000Z", subjectNames: ["Avery"] };
  mocks.save.mockReset().mockResolvedValueOnce({ reportId: "receipt" });
  expect(await eventChangeReport(scope, committed)).toMatchObject({ id: "saved-event", reportId: "receipt", reportType: "event_change", status: "recorded" });
  mocks.save.mockRejectedValueOnce(new Error("disk full"));
  const fallback = await eventChangeReport(scope, committed);
  expect(fallback).toMatchObject({ id: "saved-event", status: "recorded", reportUnavailable: true });
  expect(fallback.committedAnswer).toContain("Saturday, 2026-09-19 at 10:30");
  const clarification = { status: "needs_input", kind: "ambiguous_local_time" };
  expect(await eventChangeReport(scope, clarification)).toEqual(clarification);
  expect(mocks.save).toHaveBeenCalledTimes(2);
});
