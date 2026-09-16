import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Id, Doc } from "../_generated/dataModel";
import { owned, evidence } from "./access";
import {
  money,
  parseMoney,
  add,
  date,
  nonempty,
  partition,
  allocate,
} from "./domain";
export type Line = {
  accountId: Id<"ledger_account">;
  minor_units: number;
  currency: string;
  description: string;
};
export function postingAmount(p: Doc<"posting">) {
  if (p.minor_units !== undefined) return money(p.minor_units, p.currency);
  if (p.amount === undefined) throw new Error("Missing posting amount");
  return parseMoney(String(p.amount), p.currency);
}
export async function ownedPosting(
  ctx: QueryCtx,
  id: Id<"posting">,
  user: string,
) {
  const p = await ctx.db.get(id);
  if (!p) throw new Error("Posting not found or access denied");
  const je = await owned(ctx, "journal_entry", p.je_id, user);
  return { p, je };
}
export async function posted(ctx: QueryCtx, id: Id<"posting">, user: string) {
  const result = await ownedPosting(ctx, id, user);
  if (result.je.status !== "posted") throw new Error("Requires posted journal");
  return result;
}
export async function isReversed(ctx: QueryCtx, id: Id<"journal_entry">) {
  return Boolean(
    await ctx.db
      .query("journal_entry")
      .withIndex("by_reverses", (q) => q.eq("reverses_id", id))
      .first(),
  );
}
export async function chartFor(
  ctx: MutationCtx,
  user: string,
  chartId?: Id<"chart_of_accounts">,
  legacy?: Id<"arrangement">,
) {
  if (chartId) {
    await owned(ctx, "chart_of_accounts", chartId, user);
    return chartId;
  }
  if (!legacy) throw new Error("chartId required");
  const old = await owned(ctx, "arrangement", legacy, user);
  if (old.kind !== "ChartOfAccounts") throw new Error("Not a legacy chart");
  const match = await ctx.db
    .query("chart_of_accounts")
    .withIndex("by_legacy", (q) => q.eq("legacy_arrangement_id", legacy))
    .first();
  if (match) return match._id;
  return ctx.db.insert("chart_of_accounts", {
    user_id: user,
    name: old.name ?? "Chart of accounts",
    legacy_arrangement_id: legacy,
    created_at: Date.now(),
  });
}
export type Portion = {
  minor_units: number;
  subject_entity_id?: Id<"entity">;
  arrangement_id?: Id<"arrangement">;
  counterparty_entity_id?: Id<"entity">;
  unclassified: boolean;
  beneficiaries: {
    entity_id?: Id<"entity">;
    unassigned: boolean;
    share_bps: number;
  }[];
  reverses_id?: Id<"posting_attribution">;
};
export async function attribution(
  ctx: MutationCtx,
  user: string,
  p: Doc<"posting">,
  portions: Portion[],
  reason?: string,
) {
  partition(
    postingAmount(p),
    portions.map((x) => x.minor_units),
  );
  const sets = await ctx.db
    .query("posting_attribution_set")
    .withIndex("by_posting", (q) => q.eq("posting_id", p._id))
    .collect();
  const prev = sets.sort((a, b) => b.revision - a.revision)[0];
  for (const x of portions) {
    if (x.subject_entity_id)
      await owned(ctx, "entity", x.subject_entity_id, user);
    if (x.arrangement_id)
      await owned(ctx, "arrangement", x.arrangement_id, user);
    if (x.counterparty_entity_id)
      await owned(ctx, "entity", x.counterparty_entity_id, user);
    if (
      x.unclassified &&
      (x.subject_entity_id || x.arrangement_id || x.counterparty_entity_id)
    )
      throw new Error("Unclassified portion cannot claim classified context");
    for (const b of x.beneficiaries) {
      if (b.unassigned === Boolean(b.entity_id))
        throw new Error("Choose beneficiary entity or unassigned remainder");
      if (b.entity_id) await owned(ctx, "entity", b.entity_id, user);
    }
    allocate(
      x.minor_units,
      x.beneficiaries.map((b) => ({
        key: b.entity_id ?? "~unassigned",
        bps: b.share_bps,
      })),
    );
  }
  const revision = (prev?.revision ?? 0) + 1;
  const setId = await ctx.db.insert("posting_attribution_set", {
    user_id: user,
    posting_id: p._id,
    revision,
    recorded_at: Date.now(),
    actor: user,
    reason,
    supersedes_id: prev?._id,
  });
  for (const x of portions) {
    const { beneficiaries, ...facts } = x;
    const id = await ctx.db.insert("posting_attribution", {
      ...facts,
      set_id: setId,
      user_id: user,
      currency: p.currency,
      created_at: Date.now(),
    });
    const allocation = allocate(
      x.minor_units,
      beneficiaries.map((b) => ({
        key: b.entity_id ?? "~unassigned",
        bps: b.share_bps,
      })),
    );
    for (const b of beneficiaries)
      await ctx.db.insert("attribution_beneficiary", {
        ...b,
        user_id: user,
        attribution_id: id,
        minor_units: allocation.find(
          (r) => r.key === (b.entity_id ?? "~unassigned"),
        )!.minor_units,
      });
    if (x.reverses_id) {
      const links = await ctx.db.query("tag_assignment").collect();
      for (const link of links.filter(
        (l) =>
          l.target.kind === "posting_attribution" &&
          l.target.id === x.reverses_id &&
          l.removed_at === undefined,
      ))
        await ctx.db.insert("tag_assignment", {
          user_id: user,
          tag_id: link.tag_id,
          target: { kind: "posting_attribution", id },
          added_at: Date.now(),
        });
    }
  }
  await ctx.db.patch(p._id, { attribution_revision: revision });
  return setId;
}
export type JournalInput = {
  eventId: Id<"event">;
  chartId: Id<"chart_of_accounts">;
  memo: string;
  accounting_date: string;
  postings: Line[];
  status?: "draft" | "posted";
  evidence_ids?: Id<"evidence_item">[];
  reverses_id?: Id<"journal_entry">;
  corrects_id?: Id<"journal_entry">;
};
export async function writeJournal(
  ctx: MutationCtx,
  user: string,
  a: JournalInput,
) {
  const chart = await owned(ctx, "chart_of_accounts", a.chartId, user);
  if (chart.archived) throw new Error("Chart archived");
  const event = await owned(ctx, "event", a.eventId, user);
  if (event.voided_at !== undefined) throw new Error("Event voided");
  date(a.accounting_date);
  await evidence(ctx, a.evidence_ids, user);
  if (a.corrects_id) {
    const previous = await owned(ctx, "journal_entry", a.corrects_id, user);
    if (
      previous.status !== "posted" ||
      previous.chart_id !== a.chartId ||
      !(await isReversed(ctx, previous._id))
    )
      throw new Error(
        "Replacement requires an already reversed posted journal in this chart",
      );
  }
  if (a.postings.length < 2)
    throw new Error("Journal entry must have at least 2 postings");
  const sums = new Map<string, number>();
  for (const p of a.postings) {
    money(p.minor_units, p.currency);
    if (!p.minor_units) throw new Error("Posting amount must be nonzero");
    const account = await owned(ctx, "ledger_account", p.accountId, user);
    if (
      account.archived ||
      account.chart_id !== a.chartId ||
      account.currency !== p.currency
    )
      throw new Error(
        "Posting account must belong to selected chart and currency",
      );
    sums.set(p.currency, add(sums.get(p.currency) ?? 0, p.minor_units));
  }
  for (const sum of sums.values())
    if (sum !== 0)
      throw new Error(
        "Double-entry violation: debits must equal credits per currency",
      );
  const id = await ctx.db.insert("journal_entry", {
    user_id: user,
    chart_id: a.chartId,
    event_id: a.eventId,
    memo: a.memo,
    accounting_date: a.accounting_date,
    status: a.status ?? "posted",
    recorded_at: Date.now(),
    created_at: Date.now(),
    posted_at: a.status === "draft" ? undefined : Date.now(),
    evidence_ids: a.evidence_ids,
    reverses_id: a.reverses_id,
    corrects_id: a.corrects_id,
  });
  const postingIds: Id<"posting">[] = [];
  for (const line of a.postings) {
    const pId = await ctx.db.insert("posting", {
      user_id: user,
      je_id: id,
      account_id: line.accountId,
      minor_units: line.minor_units,
      currency: line.currency,
      description: line.description,
    });
    postingIds.push(pId);
    await attribution(ctx, user, (await ctx.db.get(pId))!, [
      {
        minor_units: line.minor_units,
        unclassified: true,
        beneficiaries: [{ unassigned: true, share_bps: 10000 }],
      },
    ]);
  }
  return { id, postingIds };
}
export async function accountBalance(
  ctx: QueryCtx,
  account: Doc<"ledger_account">,
  cutoff?: number,
) {
  const postings = await ctx.db
    .query("posting")
    .withIndex("by_account", (q) => q.eq("account_id", account._id))
    .collect();
  let total = 0,
    count = 0;
  for (const p of postings) {
    const je = await ctx.db.get(p.je_id);
    if (!je || je.status !== "posted") continue;
    const event = await ctx.db.get(je.event_id);
    // Reconciliation cutoffs are instants, not calendar accounting dates.
    const at = event?.occurred_at;
    if (cutoff !== undefined && (at === undefined || at > cutoff)) continue;
    total = add(total, postingAmount(p));
    count++;
  }
  return {
    minor_units: total,
    currency: account.currency,
    postingCount: count,
  };
}
