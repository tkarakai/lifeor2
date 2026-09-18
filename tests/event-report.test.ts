import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { consistentQuery = mocks.query; } }));
vi.mock("../lib/mcp/report-store", () => ({ saveReport: mocks.save }));
import { eventReport } from "../lib/mcp/event-report";
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
