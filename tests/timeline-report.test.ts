import { expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), save: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { consistentQuery = mocks.query; } }));
vi.mock("../lib/mcp/report-store", () => ({ saveReport: mocks.save }));
import { timelineReport } from "../lib/mcp/timeline-report";
import { presentReport } from "../lib/mcp/report-presentation";
const scope = {userId:"user",connectionId:"connection",datasetId:"dataset"};
test("an incomplete timeline cannot become selectable final evidence, including an older saved snapshot", async () => {
  mocks.query.mockReset(); mocks.save.mockReset();
  mocks.query.mockResolvedValue({items:[{amount:"700.00"}],nextOffset:null,queryComplete:false});
  await expect(timelineReport({url:"http://isolated"} as any,"token",scope,{})).rejects.toThrow("No report was saved");
  expect(mocks.save).not.toHaveBeenCalled();
  expect(() => presentReport({reportType:"timeline",items:[],queryComplete:false})).toThrow("incomplete coverage");
});
test("empty lookup attempts have no report handle; later complete evidence remains presentable", async () => {
  mocks.query.mockReset(); mocks.save.mockReset().mockResolvedValue({reportId:"complete"});
  mocks.query.mockResolvedValueOnce({items:[],nextOffset:null,queryComplete:true});
  const empty = await timelineReport({url:"http://isolated"} as any,"token",scope,{});
  expect(empty).not.toHaveProperty("reportId"); expect(mocks.save).not.toHaveBeenCalled();
  mocks.query.mockResolvedValueOnce({items:[{id:"claim",amount:"700.00"}],nextOffset:null,queryComplete:true});
  const complete = await timelineReport({url:"http://isolated"} as any,"token",scope,{});
  expect(complete).toMatchObject({reportId:"complete",queryComplete:true,items:[{id:"claim"}]});
});

test("missing workspace defaults pass through as clarification without a saved report", async () => {
  mocks.query.mockReset(); mocks.save.mockReset();
  const clarification = { status: "needs_input", kind: "workspace_scope", missing: ["household", "timezone"], question: "Which household and timezone?", executed: false };
  mocks.query.mockResolvedValue(clarification);
  expect(await timelineReport({ url: "http://isolated" } as any, "token", scope, {})).toEqual(clarification);
  expect(mocks.save).not.toHaveBeenCalled();
});
