// @vitest-environment node
import { describe, expect, it } from "vitest";
import { jsonResult, parseTarget, saveBody } from "../lib/details/server";
import { DetailsError } from "../lib/details/types";

const write = (body: unknown, headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/details", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
describe("details HTTP boundary", () => {
  it("requires a typed, explicitly supported stable target", () => {
    expect(parseTarget({ kind: "entity", id: "abc123" })).toEqual({ kind: "entity", id: "abc123" });
    for (const invalid of [{ kind: "users", id: "abc123" }, { kind: "entity", id: "../secret" }, null, "entity"]) expect(() => parseTarget(invalid)).toThrow(DetailsError);
  });
  it("requires an explicit optimistic base and validates full immutable revisions", async () => {
    const valid = { source: "", expectedCommit: null, target: { kind: "tag", id: "tag1" } };
    expect(await saveBody(write(valid))).toEqual(valid);
    for (const body of [{ source: "a" }, { source: "a", expectedCommit: "HEAD" }, { source: 1, expectedCommit: null }, null]) await expect(saveBody(write(body))).rejects.toBeInstanceOf(DetailsError);
  });
  it("rejects cross-origin writes and oversized decoded source", async () => {
    await expect(saveBody(write({ source: "a", expectedCommit: null }, { Origin: "https://other.test" }))).rejects.toMatchObject({ status: 403 });
    await expect(saveBody(write({ source: "a", expectedCommit: null }, { "Sec-Fetch-Site": "cross-site" }))).rejects.toMatchObject({ status: 403 });
    await expect(saveBody(write({ source: "é".repeat(600_000), expectedCommit: null }))).rejects.toMatchObject({ status: 413 });
    await expect(saveBody(write({ source: "a", expectedCommit: null }, { "Content-Type": "text/plain" }))).rejects.toMatchObject({ status: 415 });
  });
  it("marks all responses private/noncacheable and does not expose internal errors", async () => {
    const success = await jsonResult(async () => ({ source: "private" }));
    expect(success.headers.get("cache-control")).toBe("private, no-store");
    const failure = await jsonResult(async () => { throw new Error("secret path /Users/private"); });
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain("/Users/private");
    const unauthenticated = await jsonResult(async () => { throw new DetailsError("unauthenticated", "Sign in", 401); });
    expect(unauthenticated.status).toBe(401);
  });
});
