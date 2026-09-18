import { decimal } from "../life-reports/finance";
import { parseMoney, scale, add } from "../../convex/lib/domain";
import { QueryError } from "./query-error";
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
  order?: "amount_desc" | "amount_asc",
) {
  if (order && (report.reportType !== "financial" || report.metric === "payroll"))
    throw new QueryError("invalid_report_view", "Amount ranking requires a financial income, expense, cash, balance or profit/loss report; use the appropriate metric first.");
  if (order && report.metric === "profit_loss" && view !== "by_period")
    throw new QueryError("invalid_report_view", "Rank profit/loss with view=by_period; the ranked amount is net recorded income per period.");
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
  const pagination = (count: number, coverage = "Totals include all matching rows.") =>
    count > limit || offset > 0
      ? `\n\nDetail rows ${count ? Math.min(offset + 1, count) : 0}–${Math.min(offset + limit, count)} of ${count}. ${coverage}${offset + limit < count ? ` More detail is available from offset ${offset + limit} in this saved report.` : ""}\n\n`
      : "";
  let text = "";
  if (report.reportType === "source_excerpts") {
    text = `Retrieved source text${report.query ? ` matching “${escape(report.query)}”` : ""}\n\n`;
    for (const item of report.items.slice(offset, offset + limit)) {
      text += `Source: ${escape(item.target?.kind)} \`${escape(item.target?.id)}\` · document \`${escape(item.documentId)}\` · commit \`${escape(item.commit)}\`\n\n`;
      for (const excerpt of item.excerpts ?? []) {
        const fence = "`".repeat(Math.max(3, ...[...String(excerpt.text).matchAll(/`+/g)].map(m => m[0].length + 1)));
        text += `${fence}text\n${excerpt.text}\n${fence}\n\n`;
        text += `Source characters ${excerpt.start}–${excerpt.end} of ${item.sourceLength}.\n\n`;
      }
      text += item.sourceComplete ? "This is the complete retrieved source document.\n\n" : "Selected excerpts only. Additional text is not shown; these excerpts do not establish that there are no other terms.\n\n";
    }
    if (!report.queryComplete) text += "Source/search coverage is incomplete. More source text or search pages remain.\n";
  } else if (report.reportType === "events") {
    const f = report.filter ?? {};
    text = `Recorded events${f.query ? ` matching “${escape(f.query)}”` : ""} — ${escape(f.from ?? "all recorded history")} through ${escape(f.through ?? "all recorded future dates")}\n\n`;
    if (f.entity) text += `Subject: ${escape(f.entity)}.\n\n`;
    text += table(["Event", "Recorded local time", "UTC instant"], report.items.slice(offset, offset + limit).map((i: any) => [
      i.title,
      [i.date, i.time ?? "date only", i.time ? i.timezone : null, i.time ? i.utcOffset : null, i.clockOccurrence].filter(Boolean).join(" · "),
      i.time ? i.occurredAt : "Date only",
    ]));
    text += pagination(report.items.length, "The saved report contains all matching recorded events.") + `\n\n${escape(report.coverage)}. These are recorded events, not a claim that every real-life appointment is recorded.\n\nSources: ${report.items.slice(offset, offset + limit).map((i: any) => `\`${escape(i.id)}\``).join(", ")}`;
  } else if (report.reportType === "timeline") {
    text = `Recorded commitments and events — ${escape(report.from)} through ${escape(report.through)} (${escape(report.timezone)})\n\n`;
    const filters = report.filters;
    if (filters) {
      const labels = [filters.subject ? `Involving: ${filters.subject}` : null, filters.perspective ? `Cash-flow perspective: ${filters.perspective}` : null, filters.query ? `Matching words: ${filters.query}` : null, filters.direction ? `Direction: ${filters.direction}` : null, filters.status ? `Status: ${filters.status}` : null].filter(Boolean);
      if (labels.length) text += labels.map(escape).join("; ") + ".\n\n";
    }
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
                i.outstandingAmount && i.outstandingAmount !== i.amount ? `unpaid obligation ${i.outstandingAmount} ${i.currency}; shown amount is expected cash only` : "",
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
  } else if (report.reportType === "commitment") {
    text = `${escape(report.name)} — recorded recurring terms (revision ${escape(report.revision)})\n\n`;
    text +=
      table(
        [
          "Effective local dates (inclusive)",
          "Amount",
          "Recurrence",
          "Debtor",
          "Creditor",
        ],
        report.periods.map((p: any) => [
          `${p.localEffectiveDate} through ${p.localLastEffectiveDate ?? "ongoing"}`,
          p.amount === null ? "Variable" : amount(p.amount, p.currency),
          `${p.recurrence.frequency}; interval ${p.recurrence.interval ?? 1}${p.recurrence.day_of_month ? "; day " + p.recurrence.day_of_month : ""} (${p.timezone})`,
          p.debtor.name,
          p.creditor.name,
        ]),
      ) + "\n\n";
    if (report.reason)
      text += `Recorded reason for the latest revision: ${escape(report.reason)}.\n\n`;
    if (report.hypothetical?.length)
      text +=
        "Hypothetical comparison — no changes saved:\n\n" +
        table(
          [
            "Effective date",
            "Recorded amount",
            "Proposed amount",
            "Difference per period",
          ],
          report.hypothetical.map((h: any) => [
            h.effectiveDate,
            amount(h.recordedAmount, h.currency),
            amount(h.proposedAmount, h.currency),
            amount(h.difference, h.currency) +
              (h.interval > 1
                ? ` per recurrence (${h.frequency}, interval ${h.interval})`
                : ` per ${h.frequency} period`),
          ]),
        ) +
        "\n\n";
    text += `${escape(report.basis)}\n\nSource schedule: \`${escape(report.recordId)}\`.`;
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
      (report.obligationsAsOf ? `Outstanding obligations as of ${escape(report.obligationsAsOf)}:\n\n` : "Current outstanding obligations:\n\n") +
      (report.obligations.length
        ? table(
            ["Debtor", "Creditor", "Due", "Outstanding"],
            report.obligations.map((o: any) => [
              o.debtor,
              o.creditor,
              o.dueDate,
              o.amount === null ? `Unknown: ${o.limitation}` : amount(o.amount, o.currency),
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
      if (r.hypothetical.length || r.recurringChanges?.length)
        text +=
          `Closing without these hypothetical changes: **${amount(r.baselineClosing, r.currency)}**. Change in projected closing: **${amount(r.hypotheticalClosingChange, r.currency)}**.\n\n`;
      if (r.recurringChanges?.length)
        text += "Proposed recurring terms (not saved as records):\n\n" + table(
          ["Commitment", "Effective date", "Recorded amount", "Proposed amount", "Change per recurrence"],
          r.recurringChanges.map((c: any) => [c.schedule, c.effectiveDate, amount(c.recordedAmount, c.currency), amount(c.proposedAmount, c.currency), amount(c.difference, c.currency) + " / " + c.frequency + (c.interval > 1 ? " (interval " + c.interval + ")" : "")]),
        ) + "\n\n";
      if (r.hypothetical.length)
        text += "Additional one-off movements (not saved as records):\n\n" +
          table(
            ["Date", "Account", "Label", "Signed amount"],
            r.hypothetical.map((c: any) => [
              c.date,
              r.accounts.find((a: any) => a.id === c.accountId)?.name ?? c.accountId,
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
  } else if (report.reportType === "financial_comparison") {
    text = `Recorded ${escape(report.metric.replace(/_/g, " "))} comparison\n\nCurrent: **${escape(report.current.from)} through ${escape(report.current.through)}**. Baseline: **${escape(report.baseline.from)} through ${escape(report.baseline.through)}**.\n\n`;
    if (report.scope?.length) text += report.scope.map(escape).join("; ") + ".\n\n";
    const rows = view === "by_account" || view === "full" ? report.rows : report.totals;
    text += rows.length ? table(["Measure", "Baseline", "Current", "Change", "Change %"], rows.slice(offset, offset + limit).map((r: any) => [
      r.label, amount(r.baseline, r.currency) + (r.baselineHasMatches ? "" : " (no posted matches)"),
      amount(r.current, r.currency) + (r.currentHasMatches ? "" : " (no posted matches)"),
      amount(r.difference, r.currency), r.percentChange === null ? "Unavailable: zero baseline" : r.percentChange + "%",
    ])) : "No matching posted records in either period; no change or percentage can be established.";
    text += "\n\n" + pagination(rows.length) + escape(report.basis);
    if (report.sampleActualsThrough) text += `\n\nSample actual records were populated through ${escape(report.sampleActualsThrough)}; later dates may be incomplete.`;
    text += `\n\nSource reports: ${report.sourceReportIds.map((id: string) => "`" + escape(id) + "`").join(", ")}.`;
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
        const net = view === "by_period" && report.metric === "profit_loss";
        const period = view === "by_account" ? "All selected dates" : r.period,
          account = net ? "Net recorded income" : view === "by_period" ? r.type : r.account,
          type = net ? "Income less expenses" : r.type,
          key = JSON.stringify([period, account, type, r.currency]),
          old = grouped.get(key) ?? {
            period,
            account,
            type,
            currency: r.currency,
            minor: 0,
          };
        old.minor = add(old.minor, parseMoney(r.amount, r.currency) * (net && r.type === "Expense" ? -1 : 1));
        grouped.set(key, old);
      }
      const entries = [...grouped.values()];
      if (view === "by_period" && ["income", "expenses", "profit_loss"].includes(report.metric)) {
        for (const currency of new Set(entries.map(r => r.currency))) {
          const periods = entries.filter(r => r.currency === currency && /^\d{4}(?:-\d{2})?$/.test(r.period));
          if (periods.length < 2) continue;
          const highest = periods.reduce((a, b) => a.minor >= b.minor ? a : b);
          const tied = periods.filter(r => r.minor === highest.minor).map(r => r.period).sort();
          const measure = report.metric === "profit_loss" ? "net income" : report.metric;
          text += `Highest recorded ${measure} among periods with matching entries: **${tied.slice(0, 5).map(escape).join(", ")}${tied.length > 5 ? ` (and ${tied.length - 5} tied periods)` : ""} — ${amount(decimal(highest.minor, scale(currency)), currency)}**${tied.length > 1 ? ` (${tied.length} periods tie)` : ""}.\n\n`;
        }
      }
      if (order) {
        if (new Set(entries.map(r => r.currency)).size > 1 || new Set(entries.map(r => r.type)).size > 1)
          throw new QueryError("invalid_report_view", "Amount ranking requires one currency and comparable account types. Select a currency and a focused metric first; no currencies were converted.");
        entries.sort((a, b) => (a.minor === b.minor ? 0 : a.minor < b.minor ? -1 : 1) * (order === "amount_desc" ? -1 : 1)
          || a.period.localeCompare(b.period) || a.account.localeCompare(b.account));
        text += `Details ranked by recorded amount, ${order === "amount_desc" ? "largest" : "smallest"} first. Totals below/above cover all matching records, not just the ranked page.\n\n`;
      }
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
