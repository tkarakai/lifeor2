import { decimal } from "../life-reports/finance";
import { parseMoney, scale, add } from "../../convex/lib/domain";
const escape = (v: unknown) =>
  String(v ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/[<>]/g, "");
const table = (head: string[], rows: unknown[][]) =>
  `| ${head.join(" | ")} |\n| ${head.map(() => "---").join(" | ")} |\n${rows.map((row) => `| ${row.map(escape).join(" | ")} |`).join("\n")}`;
const amount = (v: unknown, currency: string) =>
  `${escape(v)} ${escape(currency)}`;
const sourceList = (rows: any[]) =>
  [...new Set<string>(rows.flatMap((r) => r.sourceJournalIds ?? []))]
    .slice(0, 12)
    .map((id) => `\`${escape(id)}\``)
    .join(", ");
/** Financial facts are rendered from typed server results, never retyped by the LLM. */
export function presentReport(
  report: Record<string, any>,
  view: "summary" | "by_period" | "by_account" | "full" = "summary",
  offset = 0,
  limit = 50,
) {
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error(
      "Presentation offset must be nonnegative and limit must be 1–200",
    );
  const pagination = (count: number) =>
    count > limit || offset > 0
      ? `\n\nDetail rows ${count ? Math.min(offset + 1, count) : 0}–${Math.min(offset + limit, count)} of ${count}. Totals include all matching rows.${offset + limit < count ? ` More detail is available from offset ${offset + limit} in this saved report.` : ""}\n\n`
      : "";
  let text = "";
  if (report.reportType === "timeline") {
    text = `Recorded commitments and events — ${escape(report.from)} through ${escape(report.through)} (${escape(report.timezone)})\n\n`;
    text += report.items.length
      ? table(
          ["Date", "Item", "Amount", "Meaning"],
          report.items
            .slice(offset, offset + limit)
            .map((i: any) => [
              [i.date, i.time].filter(Boolean).join(" "),
              i.title,
              i.amount ? amount(i.amount, i.currency) : "Not specified",
              [
                i.kind.replace(/_/g, " "),
                i.status,
                i.direction,
                i.parties?.length ? i.parties.join(" → ") : "",
                i.dueDate ? "due " + i.dueDate : "",
                i.amountBasis === "explicit_cash_amount"
                  ? "projected cash per payment, not gross income"
                  : "",
              ]
                .filter(Boolean)
                .join("; "),
            ]),
        )
      : "No matching recorded items were found.";
    text += "\n\n" + pagination(report.items.length);
    const totals = new Map<
      string,
      { direction: string; currency: string; minor: number }
    >();
    for (const i of report.items) {
      if (!i.amount || !i.currency) continue;
      const direction = i.direction ?? "unspecified",
        key = direction + ":" + i.currency,
        old = totals.get(key) ?? { direction, currency: i.currency, minor: 0 };
      old.minor = add(old.minor, parseMoney(i.amount, i.currency));
      totals.set(key, old);
    }
    if (totals.size)
      text +=
        "Amounts across all matching items (not a bank balance):\n\n" +
        table(
          ["Direction", "Total"],
          [...totals.values()].map((t) => [
            t.direction,
            amount(decimal(t.minor, scale(t.currency)), t.currency),
          ]),
        ) +
        "\n\n";
    for (const i of [
      ...new Map<string, any>(
        report.items
          .filter((i: any) => i.cashAmountPerPeriod)
          .map((i: any) => [
            JSON.stringify([
              i.sourceIds,
              i.contractAmount,
              i.cashAmountPerPeriod,
            ]),
            i,
          ]),
      ).values(),
    ])
      text += `${escape(i.title)}: configured cash **${amount(i.cashAmountPerPeriod, i.currency)} per ${escape(i.contractFrequency)} period**, across ${i.cashPaymentCountPerPeriod} payment(s); contract amount **${amount(i.contractAmount, i.currency)} per period**.\n\n`;
    if (report.nextOffset !== null)
      text += `This page is partial; more items remain (next offset ${report.nextOffset}).\n\n`;
    for (const w of report.warnings ?? []) text += `${escape(w)}\n\n`;
    text += `${escape(report.basis)}\n\nThis covers recorded commitments and configured projections. Other real-life commitments may be missing.\n\nSources: ${[
      ...new Set<string>(report.items.flatMap((i: any) => i.sourceIds)),
    ]
      .slice(0, 20)
      .map((id) => "`" + escape(id) + "`")
      .join(", ")}.`;
  } else if (report.reportType === "project") {
    const r = report.actuals,
      rows = r.rows as any[];
    text = `${escape(report.project.name)} — recorded activity ${escape(report.from)} through ${escape(report.through)}\n\n`;
    for (const currency of [...new Set<string>(rows.map((r) => r.currency))]) {
      const selected = rows.filter((r) => r.currency === currency),
        sum = (test: (r: any) => boolean) =>
          selected
            .filter(test)
            .reduce((n, r) => add(n, parseMoney(r.amount, currency)), 0),
        money = (n: number) => amount(decimal(n, scale(currency)), currency);
      text +=
        table(
          ["Recorded measure", "Amount"],
          [
            [
              "Non-cash asset increase (see accounts below)",
              money(sum((r) => r.type === "Asset" && !r.cashAccount)),
            ],
            ["Net cash paid", money(-sum((r) => r.cashAccount))],
            ["Posted expenses", money(sum((r) => r.type === "Expense"))],
          ],
        ) + "\n\n";
    }
    text +=
      table(
        ["Account", "Type", "Signed change"],
        rows.map((r) => [r.account, r.type, amount(r.amount, r.currency)]),
      ) + "\n\n";
    text +=
      "Current outstanding obligations:\n\n" +
      (report.obligations.length
        ? table(
            ["Debtor", "Creditor", "Due", "Outstanding"],
            report.obligations.map((o: any) => [
              o.debtor,
              o.creditor,
              o.dueDate,
              amount(o.amount, o.currency),
            ]),
          )
        : "No matching outstanding obligation is recorded.") +
      "\n\n";
    const future = report.expectations.filter(
      (f: any) => f.kind === "unincurred_assumption",
    );
    text +=
      "Still-planned work/cash assumptions (not incurred debt):\n\n" +
      (future.length
        ? table(
            ["Assumption", "Expected date", "Signed cash flow"],
            future.map((f: any) => [
              f.name,
              f.date,
              amount(f.amount, f.currency),
            ]),
          )
        : "No matching unincurred assumption is recorded.") +
      "\n\n";
    text +=
      "Linked payment expectations refer to the obligations above; they are not additional debt. Negative cash flow is an outflow. Asset acquisition is distinct from posted expense.\n\n";
    for (const note of report.notes ?? [])
      text += `Source note (commit \`${escape(note.commit)}\`${note.complete ? "" : "; excerpt"}):\n\n${String(
        note.excerpt,
      )
        .split("\n")
        .map((line: string) => "> " + line)
        .join("\n")}\n\n`;
    text += `Source journals: ${sourceList(rows)}.\n\n${escape(report.coverage)}`;
  } else if (report.reportType === "cash") {
    text = `Cash projection — ${escape(report.from)} through ${escape(report.through)}\n\n`;
    if (report.scope) text += escape(report.scope) + ".\n\n";
    if (report.included)
      text += `Outstanding commitments included; scheduled payments ${report.included.schedules ? "included" : "excluded"}; unincurred assumptions ${report.included.unincurredAssumptions ? "included" : "excluded"}.\n\n`;
    for (const r of report.reports) {
      text +=
        `${escape(r.currency)}\n\n` +
        table(
          [
            "Opening recorded cash",
            "Projected closing",
            "Lowest projected cash",
            "Lowest date",
            "First negative date",
          ],
          [
            [
              r.opening,
              r.projectedClosing,
              r.lowestProjected,
              r.lowestDate,
              r.firstNegativeDate ?? "None projected",
            ],
          ],
        ) +
        "\n\n";
      text +=
        table(
          [
            "Account",
            "Projected closing",
            "Lowest projected",
            "First negative date",
          ],
          r.accounts.map((a: any) => [
            a.name,
            a.projectedClosing,
            a.lowestProjected,
            a.firstNegativeDate ?? "None projected",
          ]),
        ) + "\n\n";
      if (r.hypothetical.length)
        text +=
          `Closing without these hypothetical movements: **${amount(r.baselineClosing, r.currency)}**. Change in projected closing: **${amount(r.hypotheticalClosingChange, r.currency)}**.\n\n` +
          "Hypothetical movements (not saved as records):\n\n" +
          table(
            ["Date", "Label", "Signed amount"],
            r.hypothetical.map((c: any) => [
              c.date,
              c.label,
              amount(c.amount, r.currency),
            ]),
          ) +
          "\n\n";
      if (r.issues.length)
        text +=
          "Unresolved inputs:\n\n" +
          table(
            ["Record", "Issue"],
            r.issues.map((i: any) => [i.name, i.reason]),
          ) +
          "\n\n";
    }
    text += report.basis;
  } else if (report.reportType === "financial") {
    const rows = report.rows as any[];
    text = ["balances", "cash_balances"].includes(report.metric)
      ? `Recorded book balances as of ${escape(report.through)} (all prior posted history)\n\n`
      : `Recorded ${escape(report.metric.replace(/_/g, " "))} — ${escape(report.from)} through ${escape(report.through)}\n\n`;
    if (report.scope?.length)
      text += report.scope.map(escape).join("; ") + ".\n\n";
    if (report.sampleActualsThrough)
      text += `Sample actual records were populated through ${escape(report.sampleActualsThrough)}; later dates may be incomplete.\n\n`;
    if (!rows.length)
      text +=
        "No matching posted records were found. This is not proof of zero real-life income or spending; an average is unavailable.\n\n";
    else if (report.metric === "payroll") {
      for (const r of report.payroll) {
        text +=
          table(
            [
              "Month",
              "Gross income",
              "Cash deposited (take-home)",
              "Withholding/other payroll expense",
            ],
            r.months
              .slice(offset, offset + limit)
              .map((m: any) => [
                m.period,
                amount(m.gross, r.currency),
                amount(m.cashDeposited, r.currency),
                amount(m.withholdingAndOtherExpenses, r.currency),
              ]),
          ) +
          pagination(r.months.length) +
          `\n\nTotal gross: **${amount(r.totalGross, r.currency)}**. Total cash deposited: **${amount(r.totalCashDeposited, r.currency)}**. Average monthly gross: **${amount(r.averageMonthlyGross, r.currency)}**. Average monthly cash: **${amount(r.averageMonthlyCash, r.currency)}** across ${r.requestedMonthCount} requested calendar months. These are monthly totals, not per-paycheck amounts.\n\n`;
      }
    } else {
      if (report.cashSummary)
        text +=
          table(
            ["Currency", "Recorded bank cash"],
            report.cashSummary.map((r: any) => [r.currency, r.cash]),
          ) + "\n\n";
      else if (report.balanceSummary)
        text +=
          table(
            [
              "Currency",
              "Book assets",
              "Book liabilities",
              "Book net worth",
              "Recorded cash",
            ],
            report.balanceSummary.map((r: any) => [
              r.currency,
              r.assets,
              r.liabilities,
              r.netWorth,
              r.cash,
            ]),
          ) + "\n\n";
      else if (report.profitLoss)
        text +=
          table(
            ["Currency", "Income", "Expense", "Net recorded income"],
            report.profitLoss.map((r: any) => [
              r.currency,
              r.income,
              r.expense,
              r.netRecordedIncome,
            ]),
          ) + "\n\n";
      else {
        const completeMonths =
          String(report.from).endsWith("-01") &&
          new Date(Date.parse(report.through) + 86400000)
            .toISOString()
            .slice(8, 10) === "01";
        const average =
          completeMonths &&
          report.requestedMonths > 1 &&
          report.totals.some((r: any) => r.averageMonthlyAmount);
        text +=
          table(
            average
              ? ["Type", "Recorded total", "Monthly average (requested months)"]
              : ["Type", "Recorded total"],
            report.totals.map((r: any) => [
              r.type,
              amount(r.amount, r.currency),
              ...(average
                ? [
                    r.averageMonthlyAmount
                      ? amount(r.averageMonthlyAmount, r.currency)
                      : "Not applicable",
                  ]
                : []),
            ]),
          ) + "\n\n";
      }
      const grouped = new Map<
        string,
        {
          period: string;
          account: string;
          type: string;
          currency: string;
          minor: number;
        }
      >();
      for (const r of rows) {
        const period = view === "by_account" ? "All selected dates" : r.period,
          account = view === "by_period" ? r.type : r.account,
          key = JSON.stringify([period, account, r.type, r.currency]),
          old = grouped.get(key) ?? {
            period,
            account,
            type: r.type,
            currency: r.currency,
            minor: 0,
          };
        old.minor = add(old.minor, parseMoney(r.amount, r.currency));
        grouped.set(key, old);
      }
      const entries = [...grouped.values()];
      text +=
        table(
          ["Period", "Account/category", "Type", "Recorded amount"],
          entries
            .slice(offset, offset + limit)
            .map((r) => [
              r.period,
              r.account,
              r.type,
              amount(decimal(r.minor, scale(r.currency)), r.currency),
            ]),
        ) + "\n\n";
      text += pagination(entries.length);
    }
    if (rows.length)
      text += `Source journal examples: ${sourceList(rows)}.\n\n`;
    if (report.warnings?.length)
      text +=
        report.warnings.map((w: string) => `- ${escape(w)}`).join("\n") +
        "\n\n";
    text += `${escape(report.basis)}\n\n${escape(report.coverage)}`;
  } else throw new Error("Unsupported saved report type");
  return (
    text +
    "\n\nDataset completeness is unknown. This is a saved evidence snapshot."
  );
}
