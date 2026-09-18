import { authComponent } from "../auth";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

import { digest, type AgentPolicy } from "../../lib/agent-contract";
export { AGENT_SCOPES, canonical, digest, type AgentScope, type AgentPolicy } from "../../lib/agent-contract";

export function deny(code: string, message: string): never { throw new ConvexError({ code, message }); }
export async function agentGrant(ctx: QueryCtx, token: string) {
  if (!/^lor_at_[A-Za-z0-9_-]{43}$/.test(token)) deny("invalid_token", "Invalid or expired access token.");
  const credential = await ctx.db.query("agent_token").withIndex("by_hash", q => q.eq("hash", digest(token))).unique();
  if (!credential || credential.kind !== "access" || credential.expires_at <= Date.now()) deny("invalid_token", "Invalid or expired access token.");
  const grant = await ctx.db.get(credential.connection_id);
  if (!grant || grant.revoked_at !== undefined || grant.expires_at <= Date.now()) deny("invalid_token", "This connection has expired or been revoked.");
  if (grant.resource !== `${process.env.SITE_URL}/mcp`) deny("invalid_token", "Incorrect token audience.");
  if (!await authComponent.getAnyUserById(ctx, grant.user_id)) deny("invalid_token", "The account no longer exists.");
  return grant;
}
export async function authorizeAgent(ctx: QueryCtx, token: string, datasetId: Id<"dataset"> | undefined, policy?: AgentPolicy) {
  const grant = await agentGrant(ctx, token);
  if (!policy || !grant.scopes.includes(policy.scope)) deny("insufficient_scope", "This connection does not have permission for this operation.");
  if (!datasetId || !grant.dataset_ids.includes(datasetId)) deny("access_denied", "An explicitly authorized dataset is required.");
  const dataset = await ctx.db.get(datasetId);
  if (!dataset || dataset.user_id !== grant.user_id) deny("access_denied", "Dataset not found or access denied.");
  return grant;
}
