import { defineSchema } from "convex/server";
import { coreSchema } from "./schema/core";
import { financeSchema } from "./schema/finance";

// Additive redesign schema. Authentication remains in the Better Auth component.

import { foundationSchema } from "./schema/foundation";
import { planningSchema } from "./schema/planning";

import { datasetSchema } from "./schema/datasets";

import { agentSchema } from "./schema/agents";

const schema = defineSchema({
  ...agentSchema,
  ...datasetSchema,
  ...foundationSchema,
  ...planningSchema,
  // Authentication is handled by @convex-dev/better-auth component
  // No need to define auth tables here

  // Stable roots plus retained legacy source records
  ...coreSchema,

  // Exact ledger and financial meaning
  ...financeSchema,
});

export default schema;
