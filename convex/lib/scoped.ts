import { v } from "convex/values";
import {
  customQuery,
  customMutation,
} from "convex-helpers/server/customFunctions";
import {
  wrapDatabaseReader,
  wrapDatabaseWriter,
  type Rules,
} from "convex-helpers/server/rowLevelSecurity";
import {
  query as baseQuery,
  mutation as baseMutation,
  type QueryCtx,
  type MutationCtx,
} from "../_generated/server";
import type { DataModel, Id, TableNames } from "../_generated/dataModel";
import { authComponent } from "../auth";
import { authorizeAgent, canonical, deny, digest, type AgentPolicy } from "./agentAuth";
import schema from "../schema";
export type { QueryCtx, MutationCtx } from "../_generated/server";

export const businessTables = Object.keys(schema.tables).filter(
  (t) => !["dataset", "dataset_preference"].includes(t) && !t.startsWith("agent_"),
) as Exclude<TableNames, "dataset" | "dataset_preference" | `agent_${string}`>[];
export type Scope = {
  userId: string | null;
  datasetId?: Id<"dataset">;
  legacy: boolean;
};
export async function resolveScope(
  ctx: QueryCtx,
  datasetId?: Id<"dataset">,
  principal?: { _id: string },
): Promise<Scope> {
  const user = principal ?? await authComponent.safeGetAuthUser(ctx);
  if (!user) {
    if (datasetId) throw new Error("Sign in to select a dataset");
    return { userId: null, legacy: false };
  }
  const dataset = datasetId
    ? await ctx.db.get(datasetId)
    : (
        await ctx.db
          .query("dataset")
          .withIndex("by_user", (q) => q.eq("user_id", user._id))
          .collect()
      ).find((d) => d.is_default);
  if (datasetId && (!dataset || dataset.user_id !== user._id))
    throw new Error("Dataset not found or access denied");
  return {
    userId: user._id,
    datasetId: dataset?._id,
    legacy: !dataset || dataset.is_default,
  };
}
function rules(scope: Scope, ctx: QueryCtx): Rules<Scope, DataModel> {
  return Object.fromEntries(
    businessTables.map((table) => {
      const allowed = async (
        _: Scope,
        doc: {
          dataset_id?: Id<"dataset">;
          user_id?: string;
          [key: string]: unknown;
        },
      ) => {
        if (!scope.userId || (doc.user_id && doc.user_id !== scope.userId))
          return false;
        if (doc.dataset_id !== undefined)
          return doc.dataset_id === scope.datasetId;
        if (!scope.legacy) return false;
        if (doc.user_id) return doc.user_id === scope.userId;
        // Legacy child rows lack user_id. Resolve their actual parent, never grant
        // access merely because two users both have un-migrated Live records.
        const parents: Record<
          string,
          [(typeof businessTables)[number], string]
        > = {
          arrangement_role: ["arrangement", "arrangement_id"],
          event_affects: ["event", "event_id"],
          posting: ["journal_entry", "je_id"],
        };
        let parent = parents[table];
        if (
          (table === "migration_map" || table === "migration_issue") &&
          businessTables.includes(doc.source_table as never)
        )
          parent = [
            doc.source_table as (typeof businessTables)[number],
            "source_id",
          ];
        if (parent && typeof doc[parent[1]] === "string") {
          const parentId = ctx.db.normalizeId(
            parent[0],
            doc[parent[1]] as string,
          );
          const row = parentId ? await ctx.db.get(parentId) : null;
          return (
            !!row &&
            "user_id" in row &&
            row.user_id === scope.userId &&
            (row.dataset_id === undefined || row.dataset_id === scope.datasetId)
          );
        }
        return false;
      };
      return [table, { read: allowed, modify: allowed, insert: allowed }];
    }),
  ) as Rules<Scope, DataModel>;
}
export function scopedWriter(
  ctx: MutationCtx,
  scope: Scope,
): MutationCtx["db"] {
  const secured = wrapDatabaseWriter(scope, ctx.db, rules(scope, ctx), {
    defaultPolicy: "deny",
  });
  return new Proxy(secured, {
    get(db, key) {
      if (key === "insert")
        return (table: TableNames, value: Record<string, unknown>) => {
          if (
            value.dataset_id !== undefined &&
            value.dataset_id !== scope.datasetId
          )
            throw new Error("Cannot write across datasets");
          return db.insert(table, {
            ...value,
            dataset_id: scope.datasetId,
          } as never);
        };
      if (key === "patch" || key === "replace")
        return (...args: unknown[]) => {
          const fields = args[args.length - 1] as Record<string, unknown>;
          if ("dataset_id" in fields && fields.dataset_id !== scope.datasetId)
            throw new Error("Cannot move records between datasets");
          if (key === "replace")
            args[args.length - 1] = { ...fields, dataset_id: scope.datasetId };
          return Reflect.apply(db[key], db, args);
        };
      const value = Reflect.get(db, key);
      return typeof value === "function" ? value.bind(db) : value;
    },
  });
}
const args = {
  datasetId: v.optional(v.id("dataset")),
  agentToken: v.optional(v.string()),
};
type AgentOptions = { agent?: AgentPolicy };
export const query = customQuery(baseQuery, {
  args,
  input: async (ctx, { datasetId, agentToken }, { agent }: AgentOptions) => {
    const grant = agentToken ? await authorizeAgent(ctx, agentToken, datasetId, agent) : null;
    const principal = grant ? { _id: grant.user_id } : await authComponent.safeGetAuthUser(ctx);
    const scope = await resolveScope(ctx, datasetId, principal ?? undefined);
    return {
      ctx: { db: wrapDatabaseReader(scope, ctx.db, rules(scope, ctx), { defaultPolicy: "deny" }), scope, principal },
      args: {},
    };
  },
});
const scopedMutation = customMutation(baseMutation, {
  args: { ...args, requestKey: v.optional(v.string()) },
  input: async (ctx, { datasetId, agentToken, requestKey }, { agent }: AgentOptions) => {
    const grant = agentToken ? await authorizeAgent(ctx, agentToken, datasetId, agent) : null;
    if (grant && (!requestKey || !/^[A-Za-z0-9_.:-]{16,128}$/.test(requestKey)))
      deny("invalid_request", "A unique requestKey (16–128 characters) is required for writes.");
    const principal = grant ? { _id: grant.user_id } : await authComponent.safeGetAuthUser(ctx);
    const scope = await resolveScope(ctx, datasetId, principal ?? undefined);
    if (scope.userId && !scope.datasetId)
      scope.datasetId = await ctx.db.insert("dataset", {
        user_id: scope.userId, name: "Live", kind: "live", is_default: true, created_at: Date.now(),
      });
    return {
      ctx: { db: scopedWriter(ctx, scope), scope, principal,
        agentExecution: grant ? { grant, requestKey: requestKey!, policy: agent!, raw: ctx } : null },
      args: {},
    };
  },
});
// Preserve the custom builder's inferred validators and result types. The
// wrapper encloses the domain handler so replay, writes and audit commit in one
// Convex transaction, including when called directly instead of through MCP.
export const mutation: typeof scopedMutation = ((definition: any) => {
  if (typeof definition === "function") throw new Error("Declare mutation arguments explicitly");
  const handler = definition.handler;
  return scopedMutation({ ...definition, handler: async (ctx, input) => {
    const execution = ctx.agentExecution;
    if (!execution) return handler(ctx, input);
    const { grant, requestKey, policy, raw } = execution;
    const inputHash = digest(canonical({ operation: policy.operation, datasetId: ctx.scope.datasetId, input }));
    const prior = await raw.db.query("agent_execution").withIndex("by_key", q => q.eq("connection_id", grant._id).eq("key", requestKey)).unique();
    if (prior) {
      if (prior.input_hash !== inputHash) deny("idempotency_conflict", "This requestKey was already used for different arguments.");
      return prior.result;
    }
    if (policy.revision && typeof input.expectedRevision !== "number") deny("revision_required", "Read the current revision and supply expectedRevision.");
    const result = await handler(ctx, input);
    await raw.db.insert("agent_execution", { connection_id: grant._id, user_id: grant.user_id,
      dataset_id: ctx.scope.datasetId, key: requestKey, operation: policy.operation,
      input_hash: inputHash, result: result ?? null, created_at: Date.now() });
    await raw.db.patch(grant._id, { last_used_at: Date.now() });
    return result;
  }});
}) as typeof scopedMutation;
