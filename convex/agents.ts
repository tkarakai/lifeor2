import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";
import { agentGrant, AGENT_SCOPES, canonical, deny, digest } from "./lib/agentAuth";
import { createDataset, selectDataset } from "./datasets";
import { buildStructure, appendMonth } from "./sampleData";

const origin = () => {
  const value = process.env.SITE_URL;
  if (!value || new URL(value).origin !== value) throw new Error("SITE_URL must be a canonical origin without a trailing slash");
  return value;
};
const resource = () => `${origin()}/mcp`;
const clientUrl = (id: string) => `${origin()}/oauth/clients/${id}`;
const hash = v.string();
function validHash(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) deny("invalid_request", "Invalid credential hash."); }
function validRedirect(value: string) {
  const url = new URL(value);
  if (url.hash || url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname))))
    deny("invalid_request", "Redirects require HTTPS or a loopback HTTP address, without fragments or credentials.");
  return value;
}
export const registerClient = mutation({
  args: { name: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, a) => {
    const user = await authComponent.getAuthUser(ctx);
    const name = a.name.trim();
    if (!name || name.length > 100 || !a.redirectUris.length || a.redirectUris.length > 10) deny("invalid_request", "Provide a client name and 1–10 exact redirect URLs.");
    const existing = await ctx.db.query("agent_client").withIndex("by_user", q => q.eq("user_id", user._id)).collect();
    if (existing.length >= 20) deny("limit_exceeded", "At most 20 clients can be registered per account.");
    const id = await ctx.db.insert("agent_client", { user_id: user._id, name, redirect_uris: [...new Set(a.redirectUris.map(validRedirect))], created_at: Date.now() });
    return { id, clientId: clientUrl(id) };
  },
});
export const clientMetadata = query({
  args: { clientId: v.string() },
  handler: async (ctx, a) => {
    if (!a.clientId.startsWith(`${origin()}/oauth/clients/`)) return null;
    const id = ctx.db.normalizeId("agent_client", a.clientId.slice(`${origin()}/oauth/clients/`.length));
    const client = id ? await ctx.db.get(id) : null;
    return client ? { client_id: clientUrl(client._id), client_name: client.name, redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } : null;
  },
});
export const connections = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    const grants = await ctx.db.query("agent_connection").withIndex("by_user", q => q.eq("user_id", user._id)).collect();
    const clients = await ctx.db.query("agent_client").withIndex("by_user", q => q.eq("user_id", user._id)).collect();
    const activity = await ctx.db.query("agent_execution").withIndex("by_user", q => q.eq("user_id", user._id)).order("desc").take(50);
    return { connections: grants, clients: clients.map(c => ({ ...c, clientId: clientUrl(c._id) })),
      activity: activity.map(({ result: _result, input_hash: _hash, ...entry }) => entry) };
  },
});
export const revoke = mutation({
  args: { id: v.id("agent_connection") },
  handler: async (ctx, a) => {
    const user = await authComponent.getAuthUser(ctx), grant = await ctx.db.get(a.id);
    if (!grant || grant.user_id !== user._id) deny("access_denied", "Connection not found.");
    await ctx.db.patch(grant._id, { revoked_at: Date.now() });
  },
});
export const authorize = mutation({
  args: { clientId: v.string(), redirectUri: v.string(), resource: v.string(), challenge: v.string(),
    scopes: v.array(v.string()), datasetIds: v.array(v.id("dataset")), codeHash: hash },
  handler: async (ctx, a) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!a.clientId.startsWith(`${origin()}/oauth/clients/`)) deny("invalid_client", "Register this client in Agent connections first.");
    const id = ctx.db.normalizeId("agent_client", a.clientId.slice(`${origin()}/oauth/clients/`.length));
    const client = id ? await ctx.db.get(id) : null;
    if (!client || !client.redirect_uris.includes(a.redirectUri)) deny("invalid_client", "Unregistered client or redirect URL.");
    if (a.resource !== resource() || !/^[A-Za-z0-9_-]{43}$/.test(a.challenge)) deny("invalid_request", "A matching resource and S256 PKCE challenge are required.");
    validHash(a.codeHash);
    if (!a.scopes.includes("data:read") || a.scopes.some(s => !AGENT_SCOPES.includes(s as never))) deny("invalid_scope", "Unsupported permissions.");
    if (!a.datasetIds.length || a.datasetIds.length > 100) deny("invalid_request", "Select at least one dataset.");
    for (const id of a.datasetIds) { const d = await ctx.db.get(id); if (!d || d.user_id !== user._id) deny("access_denied", "Dataset not found."); }
    const now = Date.now();
    const connection = await ctx.db.insert("agent_connection", { user_id: user._id, client_id: client._id, name: client.name,
      dataset_ids: [...new Set(a.datasetIds)], scopes: [...new Set(a.scopes)], resource: a.resource, created_at: now, expires_at: now + 30 * 86400000 });
    await ctx.db.insert("agent_code", { hash: a.codeHash, connection_id: connection, client_id: a.clientId,
      redirect_uri: a.redirectUri, challenge: a.challenge, resource: a.resource, expires_at: now + 5 * 60000 });
    return connection;
  },
});
export const exchange = mutation({
  args: { grantType: v.union(v.literal("authorization_code"), v.literal("refresh_token")), credential: v.string(),
    clientId: v.string(), resource: v.string(), redirectUri: v.optional(v.string()), verifier: v.optional(v.string()),
    accessHash: hash, refreshHash: hash },
  handler: async (ctx, a) => {
    validHash(a.accessHash); validHash(a.refreshHash);
    if (a.accessHash === a.refreshHash || a.resource !== resource()) return { error: "invalid_grant" };
    const now = Date.now();
    const row = a.grantType === "authorization_code"
      ? await ctx.db.query("agent_code").withIndex("by_hash", q => q.eq("hash", digest(a.credential))).unique()
      : await ctx.db.query("agent_token").withIndex("by_hash", q => q.eq("hash", digest(a.credential))).unique();
    if (!row) return { error: "invalid_grant" };
    const grant = await ctx.db.get(row.connection_id);
    if (!grant || grant.revoked_at !== undefined || grant.expires_at <= now || a.clientId !== clientUrl(grant.client_id)) return { error: "invalid_grant" };
    if (a.grantType === "authorization_code") {
      if (!("challenge" in row) || row.client_id !== a.clientId || row.redirect_uri !== a.redirectUri || row.resource !== a.resource || !a.verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(a.verifier)) return { error: "invalid_grant" };
      // PKCE challenge is base64url(SHA256(verifier)), compared as hex to avoid
      // depending on a Node runtime inside Convex.
      const challengeHex = Array.from(atob(row.challenge.replace(/-/g, "+").replace(/_/g, "/") + "="), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      if (challengeHex !== digest(a.verifier)) return { error: "invalid_grant" };
    } else if (!("kind" in row) || row.kind !== "refresh") return { error: "invalid_grant" };
    if (row.used_at !== undefined) {
      // Commit revocation on replay; throwing here would roll it back.
      await ctx.db.patch(grant._id, { revoked_at: now });
      return { error: "invalid_grant" };
    }
    if (row.expires_at <= now) return { error: "invalid_grant" };
    await ctx.db.patch(row._id, { used_at: now });
    const accessExpires = Math.min(now + 10 * 60000, grant.expires_at);
    await ctx.db.insert("agent_token", { hash: a.accessHash, kind: "access", connection_id: grant._id, expires_at: accessExpires });
    await ctx.db.insert("agent_token", { hash: a.refreshHash, kind: "refresh", connection_id: grant._id, expires_at: grant.expires_at });
    return { scope: grant.scopes.join(" "), expiresIn: Math.floor((accessExpires - now) / 1000) };
  },
});
export const revokeToken = mutation({
  args: { token: v.string(), clientId: v.string() },
  handler: async (ctx, a) => {
    const token = await ctx.db.query("agent_token").withIndex("by_hash", q => q.eq("hash", digest(a.token))).unique();
    const grant = token ? await ctx.db.get(token.connection_id) : null;
    if (grant && a.clientId === clientUrl(grant.client_id)) await ctx.db.patch(grant._id, { revoked_at: Date.now() });
  },
});
export const authenticate = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const grant = await agentGrant(ctx, a.token);
    return { connectionId: grant._id, userId: grant.user_id, clientId: clientUrl(grant.client_id), scopes: grant.scopes, datasetIds: grant.dataset_ids };
  },
});
export const admitRequest = mutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const grant = await agentGrant(ctx, a.token), window = Math.floor(Date.now() / 60000);
    const row = await ctx.db.query("agent_rate").withIndex("by_connection", q => q.eq("connection_id", grant._id)).unique();
    if (row?.window === window && row.requests >= 120) return { allowed: false };
    if (row) await ctx.db.patch(row._id, { window, requests: row.window === window ? row.requests + 1 : 1 });
    else await ctx.db.insert("agent_rate", { connection_id: grant._id, window, requests: 1 });
    return { allowed: true };
  },
});
export const listDatasets = query({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    const grant = await agentGrant(ctx, a.token);
    return (await Promise.all(grant.dataset_ids.map(id => ctx.db.get(id)))).filter(d => d && d.user_id === grant.user_id);
  },
});
export const workspace = mutation({
  args: { token: v.string(), requestKey: v.string(), operation: v.union(v.literal("create"), v.literal("select"), v.literal("prepareSample"), v.literal("populateSampleMonth")),
    name: v.optional(v.string()), datasetId: v.optional(v.id("dataset")), monthIndex: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const grant = await agentGrant(ctx, a.token);
    if (!grant.scopes.includes("datasets:manage")) deny("insufficient_scope", "Dataset management permission is required.");
    if (!/^[A-Za-z0-9_.:-]{16,128}$/.test(a.requestKey)) deny("invalid_request", "A unique requestKey is required.");
    const { token: _token, ...input } = a, inputHash = digest(canonical(input));
    const prior = await ctx.db.query("agent_execution").withIndex("by_key", q => q.eq("connection_id", grant._id).eq("key", a.requestKey)).unique();
    if (prior) { if (prior.input_hash !== inputHash) deny("idempotency_conflict", "This requestKey was used for different arguments."); return prior.result; }
    const owned = { ...ctx, principal: { _id: grant.user_id } };
    let result: unknown;
    if (a.operation === "create" || a.operation === "prepareSample") {
      if (a.operation === "create" && !a.name?.trim()) deny("invalid_request", "Provide a dataset name.");
      // Sample preparation may resume only a dataset already in this grant.
      const sample = a.operation === "prepareSample" ? (await ctx.db.query("dataset").withIndex("by_user", q => q.eq("user_id", grant.user_id)).collect()).find(d => d.seed_version) : null;
      if (sample && !grant.dataset_ids.includes(sample._id)) deny("access_denied", "Authorize the existing sample dataset before resuming it.");
      const id = a.operation === "create" ? await createDataset(owned, { name: a.name! }) : await buildStructure(owned, grant.user_id);
      await ctx.db.patch(grant._id, { dataset_ids: [...new Set([...grant.dataset_ids, id])] });
      result = { datasetId: id };
    } else {
      if (!a.datasetId || !grant.dataset_ids.includes(a.datasetId)) deny("access_denied", "Dataset is not authorized.");
      if (a.operation === "select") { await selectDataset(owned, { id: a.datasetId }); result = { datasetId: a.datasetId }; }
      else {
        if (!Number.isInteger(a.monthIndex) || a.monthIndex! < 0 || a.monthIndex! > 8) deny("invalid_request", "monthIndex must be an integer from 0 to 8.");
        result = await appendMonth(owned, grant.user_id, a.datasetId, a.monthIndex!);
      }
    }
    await ctx.db.insert("agent_execution", { connection_id: grant._id, user_id: grant.user_id, ...(a.datasetId ? { dataset_id: a.datasetId } : {}),
      key: a.requestKey, operation: `datasets.${a.operation}`, input_hash: inputHash, result, created_at: Date.now() });
    await ctx.db.patch(grant._id, { last_used_at: Date.now() });
    return result;
  },
});
