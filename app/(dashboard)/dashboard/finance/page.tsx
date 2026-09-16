import Link from "next/link";
import { Page, Panel } from "@/components/record-ui";
const sections = [
  [
    "Charts & accounts",
    "Dedicated charts of accounts and ledger account classifications.",
    "accounts",
  ],
  [
    "Journal entries",
    "Exact monetary postings with balanced debits and credits.",
    "entries",
  ],
  ["Reports", "Trial balances by chart and currency.", "reports"],
  [
    "Obligations",
    "Money owed, settlement links, and financial account mappings.",
    "obligations",
  ],
];
export default function FinancePage() {
  return (
    <Page
      title="Finance"
      description="The balanced journal is the authoritative record of financial effects."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map(([title, description, path]) => (
          <Panel key={path} title={title} description={description}>
            <Link
              className="text-sm font-medium underline underline-offset-4"
              href={`/dashboard/finance/${path}`}
            >
              Open {title.toLowerCase()} →
            </Link>
          </Panel>
        ))}
      </div>
    </Page>
  );
}
