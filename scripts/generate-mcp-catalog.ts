import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { AgentPolicy } from "../convex/lib/agentAuth";

// This inventory is explicit. New public Convex functions are not automatically
// agent-accessible: their source must opt in with an agent policy first.
const modules = [
  "agentLife",
  "agentWrites",
  "agentPlanning",
  "agentTimeline",
  "agentFinance",
  "agentQueries",
  "arrangements",
  "cashRouting",
  "entities",
  "events",
  "evidence",
  "finance",
  "measurements",
  "obligations",
  "observations",
  "planning",
  "tags",
  "trash",
];
type Validator = {
  type: string;
  value?: any;
  tableName?: string;
  keys?: Validator;
  values?: { fieldType: Validator };
};
function schema(v: Validator): any {
  switch (v.type) {
    case "object":
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(v.value).map(([k, val]) => [
            k,
            schema((val as any).fieldType),
          ]),
        ),
        required: Object.keys(v.value).filter((k) => !v.value[k].optional),
        additionalProperties: false,
      };
    case "array":
      return { type: "array", items: schema(v.value) };
    case "union":
      return { anyOf: v.value.map(schema) };
    case "literal":
      return { const: v.value, type: typeof v.value };
    case "id":
      return {
        type: "string",
        minLength: 1,
        description: `Stable ${v.tableName} record ID returned by LifeOR2.`,
      };
    case "number":
    case "float64":
      return { type: "number" };
    case "string":
    case "boolean":
    case "null":
      return { type: v.type };
    case "any":
      return {};
    case "record":
      return {
        type: "object",
        additionalProperties: schema(v.values!.fieldType),
      };
    default:
      throw new Error(`Unsupported MCP validator: ${v.type}`);
  }
}
const descriptions: Record<string, string> = {
  "records.rescheduleEvent":
    "Move an existing nonfinancial appointment/event to a local date and time. Read the current event ID first. Preserves its title, duration, subject links, notes and prior history. Already superseded records produce a conflict instead of branching history.",
  "records.recordEvent":
    "Create an appointment/event using date YYYY-MM-DD and local time HH:MM; timezone defaults to dataset configuration. Link verified subject IDs atomically. Ask if appointment time is missing. For correction of a nonfinancial event, read the old event and supply correctsId; history is retained. DST gaps/folds require clarification.",
  "records.changeSchedule":
    "Change a recurring commitment's amount, day of month or end date from an effective civil date. Read the current schedule revision first. Decimal amount is major currency units. Existing terms and later changes are preserved; old debts/payments and separate cash routes are unchanged. Never use for a hypothetical question.",
  "records.recordExpense":
    "Record a cash/bank expense or credit-card charge as a balanced posted journal. Decimal amount is major currency units. Resolve an explicit expense account and asset payment account or designated credit-card liability in the same chart; ask which payment account if the user did not specify it in this conversation. A sole available account or an earlier database transaction does not establish the payment method for this expense. A card charge increases the selected card liability without reducing bank cash. Subject attribution is optional, never inferred. For loans, asset purchases, transfers or corrections use the corresponding ledger workflow instead.",
  "life.events":
    "Find recorded events/appointments by title words, kind, subject and inclusive dates. For the next appointment, set from=today and OMIT through: returns earliest matches across all future recorded dates, not a guessed year-end cutoff. Otherwise date-only queries are newest first; title searches are relevance ranked. Compact pages with exact timestamps and timezone. Follow cursors even on empty pages. Prefer this to listing raw events; use life.timeline for upcoming commitments.",
  "life.context":
    "Get dataset timezone, current local date, default household, charts and coverage. Use for unspecified dates or family scope.",
  "life.search":
    "Find identities by name: people, household, organizations, arrangements/projects, ledger accounts, tags and schedules. Compact results with unique/ambiguous status. Empty query lists available identities; entityType optionally filters entity kinds such as Car or Person without matching company names. Do not guess IDs.",
  "life.timeline":
    "What is coming up? Upcoming events, commitments, due/overdue bills, rent, scheduled salary and expected payments in an inclusive date range. Defaults today through month end in dataset timezone. Settled obligations excluded, linked forecasts deduplicated. Projections clearly labeled. entityId narrows to that direct party/subject; omit it for the overall household calendar. Filter title query (words and common synonyms), direction=outflow for payments we owe, inflow for money we receive, or transfer, relative to the default household. entityId ONLY filters the involved party and never changes direction; set perspectiveId explicitly only when asking from another person’s/company’s perspective. status=due includes unpaid claims due in range and included arrears, even when linked to an expected payment; overdue selects past-due claims; expected selects cash expectations and schedule projections. The complete saved report is available to present; returned items are a preview. Set includeEvents=false for commitments only.",
  "reports.finances":
    "Choose scope=household for personal/household books; scope=dataset for all books or an explicit chart/person filter. Use accountQuery for a requested expense/revenue category (e.g. groceries). Compute complete recorded financial totals over inclusive from/through dates (YYYY-MM-DD). metric: cash_balances (recorded bank cash as of through, all selected checking/savings/cash accounts in one call), payroll (gross income, actual take-home deposits and monthly averages separately; PayrollDeposit events), profit_loss (income, expense and net surplus), income (gross recognized), expenses (excludes capital purchases), balances (all history through cutoff), cashflow (signed bank-account changes; use eventKind=PayrollDeposit for recorded take-home pay), activity (signed debits/credits by account, including project capital costs). groupBy: month (default), year or total. Optional currency code and verified chart/person/beneficiary/project/tag/account IDs. Server consumes all database pages; never scan journals to calculate totals. Decimal amounts are major currency units. Currencies remain separate. reportId supports drill-down via reports.read.",
  "life.read":
    "Read a typed record by verified ID before editing. Returns revision and facts. Commitment schedules also include complete current effective periods, decimal amounts, parties, recurrence and revision reason; use this before records.changeSchedule. Use specialized journal detail for postings.",
  "life.relationships":
    "Read direct roles and ownership, including the other named participants of each matched arrangement. Filter by entityId, arrangementId, role words (Owner, Tenant, Employee), arrangementQuery words, and optional asOf civil date. Complete participant lists avoid extra entity/arrangement lookups. No inferred kinship, beneficial ownership or consolidation.",
  "life.history":
    "Read recorded revisions and effective dates for an entity, arrangement or commitment schedule. Use for changes over time; revision history is different from transaction history.",
  "life.measurements":
    "Find recorded measurements/valuations through an inclusive cutoff date. Omit from to include all recorded history for an as-of question; do not guess progressively earlier start dates. Optional from narrows the interval. Filter measurement name with query (value also matches valuation/appraisal), or subjectId. Returns subject names, units, assertion types and dates; excludes superseded records. A complete empty result is no matching recorded evidence, not a reason to try synonyms.",
  "life.documents":
    "List source document targets in the selected dataset. Prefer notes.search to search text, details.read to read one verified target.",
  "agentQueries.searchEntities":
    "Find people, family members, companies and households by name; query can be empty. Omit limit for the default 50-row scan within the dataset (maximum 50). Paginated: follow nextCursor before concluding uniqueness or absence. Returns compact IDs and names.",
  "agentQueries.searchJournals":
    "Search financial journal records by inclusive from/to dates (YYYY-MM-DD), memo text, chart and explicitly attributed person/entity. Returns bounded pages WITH posting amounts in minor units, currencies and account types. Follow nextCursor even for empty pages.",
  "agentQueries.incomeSummary":
    "Calculate a person's monthly income, salary/earnings totals and average over fromMonth..toMonth (YYYY-MM). Resolve entityId first. Deterministic gross recognized Income-account totals, NOT net take-home pay. Includes signed reversals, explicit attribution, separate currencies, missing-month warnings and source journal IDs. Prefer this to listing all journals for income questions.",
  "finance.getJournalEntry":
    "Read one journal with all posting amounts, currencies and account IDs. Use searchJournals for filtered financial searches.",
  "finance.listJournalEntries":
    "List journal HEADERS only, without amounts. Prefer agentQueries.searchJournals for bounded date/person searches and agentQueries.incomeSummary for monthly earnings.",
  "entities.update":
    "Change entity facts, preserving history and identity. Read the current revision first. For a name correction now, omit effectiveAt: the server uses its current time. Never calculate a Unix timestamp just to make a current correction.",
  "arrangements.update":
    "Revise an arrangement's effective timeline, roles and terms while preserving history.",
  "finance.createJournalEntry":
    "Create a balanced financial journal with exact integer minor-unit amounts and explicit currencies. Posted entries are immutable; use reversal to correct them.",
  "finance.reverseJournalEntry":
    "Reverse a posted journal using compensating postings, preserving the original financial history.",
  "trash.permanentlyDelete":
    "Permanently delete an archived record after dependency review. This is irreversible. Call trash.inspect first.",
  "trash.restore":
    "Restore an archived record from Trash with the same IDs and history.",
  "planning.publishPlanVersion":
    "Publish an immutable version of a plan after reviewing its inputs.",
};
const replacements: Record<string, string> = {
  "agentQueries.incomeSummary": "reports.finances",
  "agentQueries.searchEntities": "life.search",
  "entities.list": "life.search",
  "arrangements.list": "life.search",
  "events.list": "life.events",
  "measurements.list": "life.measurements",
  "finance.listJournalEntries": "agentQueries.searchJournals",
};
const catalog = [];
for (const name of modules) {
  const text = await readFile(
    new URL(`../convex/${name}.ts`, import.meta.url),
    "utf8",
  );
  const exports = await import(`../convex/${name}.ts`);
  for (const match of text.matchAll(
    /export const (\w+)\s*=\s*(query|mutation)\(\{\s*agent:\s*(\{[^}]+\}),/g,
  )) {
    const [, fn, kind, literal] = match;
    const policy = JSON.parse(
      literal.replace(/([{,]\s*)(\w+):/g, '$1"$2":').replace(/,\s*}/g, "}"),
    ) as AgentPolicy;
    if (
      ["reports.projectInputs", "reports.projectionInputs"].includes(
        policy.operation,
      )
    )
      continue;
    const input = schema(JSON.parse(exports[fn].exportArgs()));
    delete input.properties.agentToken;
    input.required.push("datasetId");
    input.properties.datasetId.description =
      "Explicit authorized dataset ID. Obtain it using datasets.list. Never infer it from the browser's active dataset.";
    if (policy.operation === "reports.finances") {
      input.required.push("scope");
      input.properties.beneficiaryId.description =
        "Who benefited from an expense: use this for benefited/helped/beneficiary questions. Distinct from the accounting subject (entityId); never infer a share.";
      input.properties.entityId.description =
        "Set this when the user names a person: filters explicitly attributed subject income/costs. Omission includes all subjects in the selected books. For a company's books use chartId, not its entity ID or its owner's ID.";
      input.properties.chartId.description =
        "Scope to a company's or household's ledger books; IDs and names are in life.context.charts. Omit for all dataset books.";
      delete input.properties.cursor;
      input.required = input.required.filter((key: string) => key !== "cursor");
    }
    if (policy.operation === "life.timeline") {
      input.properties.entityId.description = "Filter records involving this party/subject. Direction remains relative to the default household; this does not change perspective.";
      input.properties.perspectiveId.description = "Optional explicit incoming/outgoing-money perspective. Omit for our/my household, even when filtering another party with entityId.";
      for (const key of ["limit", "offset"]) {
        delete input.properties[key];
        input.required = input.required.filter((k: string) => k !== key);
      }
    }
    for (const key of ["limit", "offset"])
      if (input.properties[key])
        input.properties[key] = {
          type: "integer",
          minimum: key === "limit" ? 1 : 0,
          ...(key === "limit" ? { maximum: 50 } : {}),
        };
    if (policy.operation === "agentQueries.incomeSummary") {
      input.properties.fromMonth = {
        type: "string",
        pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$",
        description: "First included calendar month, YYYY-MM.",
      };
      input.properties.toMonth = {
        type: "string",
        pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$",
        description:
          "Last included calendar month, YYYY-MM. Inclusive, not the following month.",
      };
      input.properties.chartId.description +=
        " Optional: omit for income across all charts. Only supply a verified chart ID when the user requests that chart.";
    }
    if (kind === "mutation") {
      input.required.push("requestKey");
      input.properties.requestKey = {
        type: "string",
        minLength: 16,
        maxLength: 128,
        pattern: "^[A-Za-z0-9_.:-]+$",
        description:
          "Unique operation key (UUID recommended). Reuse only when retrying exactly the same operation and arguments.",
      };
    }
    if (policy.revision && !input.required.includes("expectedRevision"))
      input.required.push("expectedRevision");
    const title =
      (
        {
          "agentQueries.searchEntities": "Find people and organizations",
          "agentQueries.searchJournals": "Search financial records",
          "agentQueries.incomeSummary": "Monthly income",
        } as Record<string, string>
      )[policy.operation] ??
      `${name}: ${fn.replace(/([A-Z])/g, " $1").toLowerCase()}`;
    catalog.push({
      name: policy.operation,
      title,
      ...(replacements[policy.operation] ? { replacedBy: replacements[policy.operation] } : {}),
      ...([
        "life.context",
        "life.search",
        "life.timeline",
        "life.relationships",
        "life.events",
        "reports.finances",
      ].includes(policy.operation)
        ? { primary: true }
        : {}),
      description:
        descriptions[policy.operation] ??
        `${title}. Uses the same validation, authorization, history and dataset isolation as the LifeOR2 UI. Dates are YYYY-MM-DD; timestamps are Unix milliseconds; monetary minor_units are exact integers.`,
      functionName: `${name}:${fn}`,
      kind,
      scope: policy.scope,
      inputSchema: input,
    });
  }
}
catalog.sort((a, b) => a.name.localeCompare(b.name));
await mkdir(new URL("../lib/mcp", import.meta.url), { recursive: true });
const output = JSON.stringify(catalog, null, 2) + "\n";
const file = new URL("../lib/mcp/catalog.json", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await readFile(file, "utf8")) !== output)
    throw new Error("MCP catalog is stale. Run bun run mcp:catalog.");
} else {
  await writeFile(file, output);
  console.log(`Generated ${catalog.length} MCP domain tools.`);
}
