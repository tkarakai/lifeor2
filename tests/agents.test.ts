/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi, afterEach } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import schema from "../convex/schema";
import authSchema from "../node_modules/@convex-dev/better-auth/src/component/schema";
import { api, components } from "../convex/_generated/api";
import { digest } from "../convex/lib/agentAuth";
import { businessTables } from "../convex/lib/scoped";
const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js"]);
const authModules = import.meta.glob("../node_modules/@convex-dev/better-auth/src/component/**/*.ts");
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function setup(scopes = ["data:read", "data:write", "finance:write", "data:delete", "datasets:manage"]) {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  const t = convexTest(schema, modules); t.registerComponent("betterAuth", authSchema, authModules);
  async function login(email: string) {
    const now = Date.now();
    const user = await t.mutation(components.betterAuth.adapter.create, { input: { model: "user", data: { name: email, email, emailVerified: true, createdAt: now, updatedAt: now } } });
    const session = await t.mutation(components.betterAuth.adapter.create, { input: { model: "session", data: { userId: user._id, token: email, expiresAt: now + 864000000, createdAt: now, updatedAt: now } } });
    return t.withIdentity({ subject: user._id, sessionId: session._id });
  }
  const alice = await login("alice@agents.test"), bob = await login("bob@agents.test");
  const datasetId = await alice.mutation(api.datasets.initialize, {}), otherDataset = await alice.mutation(api.datasets.create, { name: "Other" });
  const bobDataset = await bob.mutation(api.datasets.initialize, {});
  const { clientId } = await alice.mutation(api.agents.registerClient, { name: "Test agent", redirectUris: ["http://127.0.0.1:8765/callback"] });
  const verifier = "v".repeat(43), code = "secret-code", access = "lor_at_" + "a".repeat(43), refresh = "lor_rt_" + "r".repeat(43);
  const challenge = btoa(String.fromCharCode(...sha256(new TextEncoder().encode(verifier)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const authArgs = { clientId, redirectUri: "http://127.0.0.1:8765/callback", resource: "http://localhost:3000/mcp", challenge, scopes, datasetIds: [datasetId], codeHash: digest(code) };
  const grant = await alice.mutation(api.agents.authorize, authArgs);
  const exchange = { grantType: "authorization_code" as const, credential: code, clientId, redirectUri: authArgs.redirectUri, resource: authArgs.resource, verifier, accessHash: digest(access), refreshHash: digest(refresh) };
  const issued = await t.mutation(api.agents.exchange, exchange); expect(issued.error).toBeUndefined();
  return { t, alice, bob, datasetId, otherDataset, bobDataset, grant, access, refresh, exchange, authArgs, clientId };
}
test("OAuth grants preserve user and dataset isolation even when Convex is called directly", async () => {
  const f = await setup(), { t, alice, bob, datasetId, access } = f;
  const id = await t.mutation(api.entities.create, { agentToken: access, datasetId, requestKey: "create-entity-0001", kind: "Person", display_name: "Agent-created" });
  expect((await alice.query(api.entities.list, { datasetId }))[0]._id).toBe(id);
  expect(await bob.query(api.entities.list, { datasetId: f.bobDataset })).toEqual([]);
  expect(await t.query(api.entities.list, { agentToken: access, datasetId })).toHaveLength(1);
  for (const deniedDataset of [f.otherDataset, f.bobDataset, undefined])
    await expect(t.query(api.entities.list, { agentToken: access, ...(deniedDataset ? { datasetId: deniedDataset } : {}) })).rejects.toThrow("authorized dataset");
  await expect(t.query(api.insights.snapshot, { agentToken: access, datasetId })).rejects.toThrow("permission");
  expect((await alice.query(api.agents.connections, {})).activity[0].connection_id).toBe(f.grant);
  expect(businessTables.some(t => t.startsWith("agent_"))).toBe(false);
});
test("read-only grants cannot write and ordinary editors cannot post financial changes", async () => {
  const { t, access, datasetId } = await setup(["data:read"]);
  await expect(t.mutation(api.entities.create, { agentToken: access, datasetId, requestKey: "read-only-create-01", kind: "Person", display_name: "Denied" })).rejects.toThrow("permission");
  const w = await setup(["data:read", "data:write"]);
  await expect(w.t.mutation(api.finance.createChart, { agentToken: w.access, datasetId: w.datasetId, requestKey: "no-finance-write-01", name: "Denied" })).rejects.toThrow("permission");
});
test("idempotency and audit are atomic, reject changed payloads, and enforce edit revisions", async () => {
  const { t, alice, access, datasetId } = await setup();
  const input = { agentToken: access, datasetId, requestKey: "repeat-create-0001", kind: "Person", display_name: "Once" };
  const id = await t.mutation(api.entities.create, input);
  expect(await t.mutation(api.entities.create, input)).toBe(id);
  expect(await alice.query(api.entities.list, { datasetId })).toHaveLength(1);
  expect((await alice.query(api.agents.connections, {})).activity).toHaveLength(1);
  await expect(t.mutation(api.entities.create, { ...input, display_name: "Changed" })).rejects.toThrow("different arguments");
  await expect(t.mutation(api.entities.update, { agentToken: access, datasetId, requestKey: "update-revision-01", id, display_name: "Changed" })).rejects.toThrow("expectedRevision");
  await t.mutation(api.entities.update, { agentToken: access, datasetId, requestKey: "update-revision-01", id, display_name: "Changed", expectedRevision: 1 });
  await expect(t.mutation(api.entities.update, { agentToken: access, datasetId, requestKey: "update-revision-02", id, display_name: "Stale", expectedRevision: 1 })).rejects.toThrow("Revision conflict");
  expect((await alice.query(api.agents.connections, {})).activity).toHaveLength(2);
});
test("revocation, expiry and resource binding are enforced on every operation", async () => {
  const { t, alice, bob, access, datasetId, grant } = await setup();
  await expect(bob.mutation(api.agents.revoke, { id: grant })).rejects.toThrow("not found");
  vi.stubEnv("SITE_URL", "https://different.example");
  await expect(t.query(api.agents.authenticate, { token: access })).rejects.toThrow("audience");
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  await alice.mutation(api.agents.revoke, { id: grant });
  await expect(t.query(api.entities.list, { agentToken: access, datasetId })).rejects.toThrow("revoked");
  const f = await setup(); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 11 * 60000);
  await expect(f.t.query(api.agents.authenticate, { token: f.access })).rejects.toThrow("expired");
});
test("authorization code exchange binds PKCE, redirect, client and resource; replay revokes", async () => {
  const { t, exchange, access } = await setup();
  for (const change of [{ verifier: "x".repeat(43) }, { redirectUri: "http://127.0.0.1:9999/callback" }, { clientId: "other" }, { resource: "https://wrong.example/mcp" }])
    expect(await t.mutation(api.agents.exchange, { ...exchange, ...change })).toEqual({ error: "invalid_grant" });
  expect(await t.query(api.agents.authenticate, { token: access })).toHaveProperty("connectionId");
  expect(await t.mutation(api.agents.exchange, exchange)).toEqual({ error: "invalid_grant" });
  await expect(t.query(api.agents.authenticate, { token: access })).rejects.toThrow("revoked");
});
test("refresh tokens rotate, and reuse revokes the whole connection", async () => {
  const { t, refresh, clientId, access } = await setup();
  const nextAccess = "lor_at_" + "n".repeat(43);
  const args = { grantType: "refresh_token" as const, credential: refresh, clientId, resource: "http://localhost:3000/mcp", accessHash: digest(nextAccess), refreshHash: digest("lor_rt_" + "z".repeat(43)) };
  expect((await t.mutation(api.agents.exchange, args)).error).toBeUndefined();
  expect(await t.query(api.agents.authenticate, { token: nextAccess })).toHaveProperty("connectionId");
  expect(await t.mutation(api.agents.exchange, args)).toEqual({ error: "invalid_grant" });
  for (const token of [access, nextAccess]) await expect(t.query(api.agents.authenticate, { token })).rejects.toThrow("revoked");
});
test("consent validates ownership and permissions; dataset management extends only its own grant", async () => {
  const { t, alice, bobDataset, access, authArgs, clientId } = await setup();
  await expect(alice.mutation(api.agents.authorize, { ...authArgs, datasetIds: [bobDataset] })).rejects.toThrow("Dataset not found");
  await expect(alice.mutation(api.agents.authorize, { ...authArgs, scopes: ["admin"] })).rejects.toThrow("permissions");
  await expect(alice.mutation(api.agents.registerClient, { name: "Unsafe", redirectUris: ["https://safe.example/cb#fragment"] })).rejects.toThrow("Redirects");
  const created = await t.mutation(api.agents.workspace, { token: access, requestKey: "new-dataset-0001", operation: "create", name: "Agent workspace" });
  expect((await t.query(api.agents.listDatasets, { token: access })).map(d => d?._id)).toContain(created.datasetId);
  expect((await t.query(api.agents.clientMetadata, { clientId }))?.client_id).toBe(clientId);
});
test("MCP admission limits each connection independently and resets the next minute", async () => {
  const { t, access } = await setup();
  vi.useFakeTimers(); vi.setSystemTime(Math.floor(Date.now() / 60000) * 60000 + 1000);
  for (let i = 0; i < 120; i++) expect(await t.mutation(api.agents.admitRequest, { token: access })).toEqual({ allowed: true });
  expect(await t.mutation(api.agents.admitRequest, { token: access })).toEqual({ allowed: false });
  vi.setSystemTime(Date.now() + 60000);
  expect(await t.mutation(api.agents.admitRequest, { token: access })).toEqual({ allowed: true });
});
