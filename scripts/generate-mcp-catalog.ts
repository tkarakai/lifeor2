import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { AgentPolicy } from "../convex/lib/agentAuth";

// This inventory is explicit. New public Convex functions are not automatically
// agent-accessible: their source must opt in with an agent policy first.
const modules = ["agentQueries", "arrangements", "cashRouting", "entities", "events", "evidence", "finance", "measurements", "obligations", "observations", "planning", "tags", "trash"];
type Validator = { type: string; value?: any; tableName?: string; keys?: Validator; values?: { fieldType: Validator } };
function schema(v: Validator): any {
  switch (v.type) {
    case "object": return { type: "object", properties: Object.fromEntries(Object.entries(v.value).map(([k, val]) => [k, schema((val as any).fieldType)])), required: Object.keys(v.value).filter(k => !v.value[k].optional), additionalProperties: false };
    case "array": return { type: "array", items: schema(v.value) };
    case "union": return { anyOf: v.value.map(schema) };
    case "literal": return { const: v.value, type: typeof v.value };
    case "id": return { type: "string", minLength: 1, description: `Stable ${v.tableName} record ID returned by LifeOR2.` };
    case "number": case "float64": return { type: "number" };
    case "string": case "boolean": case "null": return { type: v.type };
    case "any": return {};
    case "record": return { type: "object", additionalProperties: schema(v.values!.fieldType) };
    default: throw new Error(`Unsupported MCP validator: ${v.type}`);
  }
}
const descriptions: Record<string, string> = {
  "agentQueries.searchEntities": "Find people, family members, companies and households by name; query can be empty. Omit limit for the default 50-row scan within the dataset (maximum 50). Paginated: follow nextCursor before concluding uniqueness or absence. Returns compact IDs and names.",
  "agentQueries.searchJournals": "Search financial journal records by inclusive from/to dates (YYYY-MM-DD), memo text, chart and explicitly attributed person/entity. Returns bounded pages WITH posting amounts in minor units, currencies and account types. Follow nextCursor even for empty pages.",
  "agentQueries.incomeSummary": "Calculate a person's monthly income, salary/earnings totals and average over fromMonth..toMonth (YYYY-MM). Resolve entityId first. Deterministic gross recognized Income-account totals, NOT net take-home pay. Includes signed reversals, explicit attribution, separate currencies, missing-month warnings and source journal IDs. Prefer this to listing all journals for income questions.",
  "finance.getJournalEntry": "Read one journal with all posting amounts, currencies and account IDs. Use searchJournals for filtered financial searches.",
  "finance.listJournalEntries": "List journal HEADERS only, without amounts. Prefer agentQueries.searchJournals for bounded date/person searches and agentQueries.incomeSummary for monthly earnings.",
  "entities.update": "Change entity facts from an effective date, preserving history. Read the current revision first.",
  "arrangements.update": "Revise an arrangement's effective timeline, roles and terms while preserving history.",
  "finance.createJournalEntry": "Create a balanced financial journal with exact integer minor-unit amounts and explicit currencies. Posted entries are immutable; use reversal to correct them.",
  "finance.reverseJournalEntry": "Reverse a posted journal using compensating postings, preserving the original financial history.",
  "trash.permanentlyDelete": "Permanently delete an archived record after dependency review. This is irreversible. Call trash.inspect first.",
  "trash.restore": "Restore an archived record from Trash with the same IDs and history.",
  "planning.publishPlanVersion": "Publish an immutable version of a plan after reviewing its inputs.",
};
const catalog = [];
for (const name of modules) {
  const text = await readFile(new URL(`../convex/${name}.ts`, import.meta.url), "utf8");
  const exports = await import(`../convex/${name}.ts`);
  for (const match of text.matchAll(/export const (\w+) = (query|mutation)\(\{\s*agent: (\{[^\n]+\}),/g)) {
    const [, fn, kind, literal] = match;
    const policy = JSON.parse(literal.replace(/([{,]\s*)(\w+):/g, '$1"$2":')) as AgentPolicy;
    const input = schema(JSON.parse(exports[fn].exportArgs()));
    delete input.properties.agentToken;
    input.required.push("datasetId");
    input.properties.datasetId.description = "Explicit authorized dataset ID. Obtain it using datasets.list. Never infer it from the browser's active dataset.";
    if (policy.operation === "agentQueries.incomeSummary") {
      input.properties.fromMonth = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$", description: "First included calendar month, YYYY-MM." };
      input.properties.toMonth = { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$", description: "Last included calendar month, YYYY-MM. Inclusive, not the following month." };
      input.properties.chartId.description += " Optional: omit for income across all charts. Only supply a verified chart ID when the user requests that chart.";
    }
    if (kind === "mutation") {
      input.required.push("requestKey");
      input.properties.requestKey = { type: "string", minLength: 16, maxLength: 128, pattern: "^[A-Za-z0-9_.:-]+$", description: "Unique operation key (UUID recommended). Reuse only when retrying exactly the same operation and arguments." };
    }
    if (policy.revision && !input.required.includes("expectedRevision")) input.required.push("expectedRevision");
    const title = ({ "agentQueries.searchEntities": "Find people and organizations", "agentQueries.searchJournals": "Search financial records", "agentQueries.incomeSummary": "Monthly income" } as Record<string, string>)[policy.operation] ?? `${name}: ${fn.replace(/([A-Z])/g, " $1").toLowerCase()}`;
    catalog.push({ name: policy.operation, title, ...(["agentQueries.searchEntities", "agentQueries.incomeSummary"].includes(policy.operation) ? { primary: true } : {}), description: descriptions[policy.operation] ?? `${title}. Uses the same validation, ownership rules, history and dataset isolation as the LifeOR2 UI. Dates are YYYY-MM-DD; timestamps are Unix milliseconds; monetary minor_units are exact integers.`,
      functionName: `${name}:${fn}`, kind, scope: policy.scope, inputSchema: input });
  }
}
catalog.sort((a, b) => a.name.localeCompare(b.name));
await mkdir(new URL("../lib/mcp", import.meta.url), { recursive: true });
const output = JSON.stringify(catalog, null, 2) + "\n";
const file = new URL("../lib/mcp/catalog.json", import.meta.url);
if (process.argv.includes("--check")) {
  if (await readFile(file, "utf8") !== output) throw new Error("MCP catalog is stale. Run bun run mcp:catalog.");
} else { await writeFile(file, output); console.log(`Generated ${catalog.length} MCP domain tools.`); }
