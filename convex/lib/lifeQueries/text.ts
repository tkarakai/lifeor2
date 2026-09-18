/** Small domain vocabulary for lexical retrieval, not question-specific routing. */
const aliases: Record<string, string> = {
  valuation: "value",
  paycheck: "payroll",
  paycheque: "payroll",
  salary: "payroll",
  wage: "payroll",
  car: "vehicle",
  automobile: "vehicle",
  auto: "vehicle",
  earning: "income",
  revenue: "income",
  renting: "rental",
  appointment: "appointment",
  dentist: "dental",
  dentistry: "dental",
  grocery: "groceries",
  repair: "maintenance",
  servicing: "service",
};
export function queryTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map((word) => {
          const singular = word.endsWith("ies")
            ? word.slice(0, -3) + "y"
            : word.length > 3 && word.endsWith("s") && !word.endsWith("ss")
              ? word.slice(0, -1)
              : word;
          return aliases[singular] ?? singular;
        }),
    ),
  ];
}
export function matchesText(text: string, query: string) {
  const haystack = new Set(queryTerms(text));
  return queryTerms(query).every((term) => haystack.has(term));
}
