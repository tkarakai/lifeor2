import Link from "next/link";
import { Page, Panel } from "@/components/record-ui";
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
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map(([title, description, path]) => (
          <Panel key={path} title={title} description={description}>
            <Link
              className="text-sm font-medium underline underline-offset-4"
              href={`/dashboard/${path}`}
            >
              Open {title.toLowerCase()} →
            </Link>
          </Panel>
        ))}
      </div>
    </Page>
  );
}
