import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Page } from "@/components/record-ui";
const sections = [
  [
    "Family observatory",
    "27 interactive views of your money, family, history, and possibilities ahead.",
    "insights",
  ],
  [
    "Entities",
    "People, organizations, animals, and identifiable assets.",
    "entities",
  ],
  [
    "Arrangements",
    "Continuing relationships, custom types, and local roles.",
    "arrangements",
  ],
  ["Events", "Actual occurrences and their affected records.", "events"],
  [
    "Measurements",
    "Observed, contractual, expected, and derived quantities.",
    "measurements",
  ],
  [
    "Tags",
    "Group related records, including projects, with simple tags.",
    "tags",
  ],
  [
    "Finance",
    "Charts, accounts, balanced journals, and monetary obligations.",
    "finance",
  ],
  [
    "Planning",
    "Plans and expected occurrences kept separate from actual events.",
    "planning",
  ],
];
export default function DashboardPage() {
  return (
    <Page
      title="Your records"
      description="Keep identity, relationships, actual occurrences, and financial records connected."
    >
      <div className="record-directory">
        {sections.map(([title, description, path], index) => (
          <Link key={path} href={`/dashboard/${path}`}>
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
