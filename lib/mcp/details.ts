import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { DetailsService, type DetailsBackend } from "@/lib/details/service";
import { GitDetailsRepository } from "@/lib/details/git";
import { backend } from "./http";

export function agentDetails(token: string, datasetId: string, writable: boolean, connectionId: string) {
  const client = backend();
  const scope = { agentToken: token, datasetId: datasetId as Id<"dataset"> };
  const repositoryKey = process.env.DETAILS_REPOSITORY_KEY ?? "local";
  const adapter: DetailsBackend = {
    currentUser: async () => ({ _id: (await client.query(api.agents.authenticate, { token })).userId }),
    get: id => client.query(api.details.get, { ...scope, id: id as Id<"details_document"> }),
    forTarget: target => client.query(api.details.forTarget, { ...scope, target: target as never }),
    ensure: async (target, repositoryKey) => {
      if (!writable) throw new Error("Read-only connection");
      return client.mutation(api.details.ensure, { ...scope, target: target as never, repositoryKey, requestKey: randomUUID() });
    },
    // Read-only agents do not mutate the document cache as a side effect of reading.
    observe: async (id, commit, availability) => {
      if (writable) await client.mutation(api.details.observe, { ...scope, id: id as Id<"details_document">,
        ...(commit ? { commit } : {}), availability, requestKey: randomUUID() });
    },
  };
  return new DetailsService(adapter, new GitDetailsRepository({
    directory: path.resolve(process.env.DETAILS_REPOSITORY_PATH ?? ".convex/details-content.git"),
    branch: process.env.DETAILS_GIT_BRANCH ?? "main", authorName: `LifeOR2 agent ${connectionId}`, authorEmail: "agents@lifeor.local",
  }), repositoryKey);
}
