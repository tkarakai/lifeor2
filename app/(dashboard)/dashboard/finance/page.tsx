import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Page } from "@/components/record-ui";
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
      <div className="record-directory">
        {sections.map(([title, description, path], index) => (
          <Link key={path} href={`/dashboard/finance/${path}`}>
            <span className="record-directory-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
            <ArrowUpRight size={20} strokeWidth={1.5} />
          </Link>
        ))}
      </div>
    </Page>
  );
}
