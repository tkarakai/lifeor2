import { indexObligation } from "./obligationIndex";
import type { MutationCtx } from "../../_generated/server";
import type { Id, TableNames } from "../../_generated/dataModel";
import { postingAmount } from "../ledger";
import { add } from "../domain";

/** Exact daily cells. Source journals remain authoritative; old contributions
 * are subtracted before replacements, in the same transaction as the edit. */
export type Cell = {
  key: string;
  date: string;
  chartId?: string;
  accountId: string;
  currency: string;
  eventKind?: string;
  subjectId?: string;
  arrangementId?: string;
  beneficiaryId?: string;
  basis: "posting" | "beneficiary";
  tags: string[];
  amount: number;
  count: number;
};
const tables = [
  "monetary_obligation",
  "obligation_adjustment",
  "obligation_settlement",
  "event",
  "journal_entry",
  "posting",
  "posting_attribution_set",
  "posting_attribution",
  "attribution_beneficiary",
  "tag_assignment",
] as const;
export function financeTracker(ctx: MutationCtx, datasetId?: Id<"dataset">) {
  const dirty = new Set<Id<"journal_entry">>();
  const claims = new Set<Id<"monetary_obligation">>();
  const journalFor = async (
    table: string,
    row: Record<string, any> | null,
  ): Promise<void> => {
    if (!row) return;
    if (table === "monetary_obligation") {
      claims.add(row._id);
      return;
    }
    if (
      table === "obligation_adjustment" ||
      table === "obligation_settlement"
    ) {
      claims.add(row.obligation_id);
      return;
    }
    if (table === "event") {
      const journals = await ctx.db
        .query("journal_entry")
        .withIndex("by_event", (q) => q.eq("event_id", row._id))
        .take(101);
      if (journals.length > 100)
        throw new Error(
          "Event exceeds 100 journals; use an operator migration",
        );
      for (const j of journals) dirty.add(j._id);
      return;
    }
    if (table === "journal_entry") {
      dirty.add(row._id);
      return;
    }
    if (table === "posting") {
      dirty.add(row.je_id);
      return;
    }
    if (table === "posting_attribution_set")
      return journalFor("posting", await ctx.db.get(row.posting_id));
    if (table === "posting_attribution")
      return journalFor(
        "posting_attribution_set",
        await ctx.db.get(row.set_id),
      );
    if (table === "attribution_beneficiary")
      return journalFor(
        "posting_attribution",
        await ctx.db.get(row.attribution_id),
      );
    if (table === "tag_assignment") {
      const target = row.target;
      if (!target) return;
      if (target.kind === "event")
        await journalFor("event", { _id: target.id });
      else if (
        ["journal_entry", "posting", "posting_attribution"].includes(
          target.kind,
        )
      )
        await journalFor(target.kind, await ctx.db.get(target.id));
    }
  };
  return {
    async changed(id: Id<TableNames>) {
      if (!datasetId) return;
      const table = tables.find((t) => ctx.db.normalizeId(t, id));
      if (table) await journalFor(table, await ctx.db.get(id));
    },
    async flush() {
      if (!datasetId) return;
      for (const id of dirty) await indexJournal(ctx, datasetId, id);
      dirty.clear();
      for (const id of claims) await indexObligation(ctx, datasetId, id);
      claims.clear();
    },
  };
}
export async function indexJournal(
  ctx: MutationCtx,
  datasetId: Id<"dataset">,
  id: Id<"journal_entry">,
) {
  const previous = await ctx.db
    .query("agent_finance_entry")
    .withIndex("by_journal", (q) => q.eq("journal_id", id))
    .unique();
  const journal = await ctx.db.get(id),
    cells: Cell[] = [];
  if (
    journal &&
    journal.dataset_id === datasetId &&
    journal.status === "posted" &&
    journal.accounting_date
  ) {
    const postings = await ctx.db
      .query("posting")
      .withIndex("by_je", (q) => q.eq("je_id", id))
      .take(101);
    if (postings.length > 100)
      throw new Error("Journal exceeds report indexing budget");
    const parts = await Promise.all(
      postings.map(async (p) => {
        const sets = await ctx.db
          .query("posting_attribution_set")
          .withIndex("by_posting", (q) => q.eq("posting_id", p._id))
          .collect();
        const latest = sets.sort((a, b) => b.revision - a.revision)[0];
        return latest
          ? await ctx.db
              .query("posting_attribution")
              .withIndex("by_set", (q) => q.eq("set_id", latest._id))
              .collect()
          : [];
      }),
    );
    const all = parts.flat(),
      subjects = new Set(all.map((p) => p.subject_entity_id)),
      sole =
        all.length &&
        subjects.size === 1 &&
        !all.some((p) => p.unclassified || !p.subject_entity_id)
          ? all[0].subject_entity_id
          : undefined;
    const tags = async (target: string) => {
      const links = await ctx.db
        .query("tag_assignment")
        .withIndex("by_target", (q) => q.eq("target.id", target as never))
        .collect();
      return links
        .filter((l) => l.removed_at === undefined)
        .map((l) => String(l.tag_id));
    };
    const event = await ctx.db.get(journal.event_id);
    const common = [...(await tags(id)), ...(await tags(journal.event_id))];
    for (const [i, p] of postings.entries()) {
      const directTags = [...common, ...(await tags(p._id))],
        base = {
          date: journal.accounting_date,
          chartId: journal.chart_id,
          accountId: p.account_id,
          currency: p.currency,
          eventKind: event?.kind,
        };
      const emit = (fields: Omit<Cell, "key" | "count">) => {
        const cleaned = JSON.parse(JSON.stringify(fields));
        const { amount, ...dimensions } = cleaned;
        cells.push({ ...cleaned, key: JSON.stringify(dimensions), count: 1 });
      };
      if (!parts[i].length)
        emit({
          ...base,
          basis: "posting",
          subjectId: sole,
          tags: [...new Set(directTags)].sort(),
          amount: postingAmount(p),
        });
      else
        for (const part of parts[i]) {
          const classified = {
            ...base,
            subjectId: part.unclassified ? undefined : part.subject_entity_id,
            arrangementId: part.unclassified ? undefined : part.arrangement_id,
            tags: [
              ...new Set([...directTags, ...(await tags(part._id))]),
            ].sort(),
          };
          emit({ ...classified, basis: "posting", amount: part.minor_units });
          if (!part.unclassified)
            for (const b of await ctx.db
              .query("attribution_beneficiary")
              .withIndex("by_attribution", (q) =>
                q.eq("attribution_id", part._id),
              )
              .collect())
              if (!b.unassigned && b.entity_id)
                emit({
                  ...classified,
                  basis: "beneficiary",
                  beneficiaryId: b.entity_id,
                  amount: b.minor_units,
                });
        }
    }
  }
  const deltas = new Map<
    string,
    { cell: Cell; amount: number; count: number }
  >();
  for (const [source, sign] of [
    [previous?.cells ?? [], -1],
    [cells, 1],
  ] as const)
    for (const c of source) {
      const old = deltas.get(c.key) ?? { cell: c as Cell, amount: 0, count: 0 };
      old.amount = add(old.amount, sign * c.amount);
      old.count += sign * c.count;
      deltas.set(c.key, old);
    }
  for (const [key, d] of deltas) {
    const old = await ctx.db
      .query("agent_finance_cell")
      .withIndex("by_key", (q) => q.eq("dataset_id", datasetId).eq("key", key))
      .unique();
    const amount = add(old?.amount ?? 0, d.amount),
      count = (old?.count ?? 0) + d.count;
    if (count < 0) throw new Error("Invalid reporting index count");
    if (!count) {
      if (old) await ctx.db.delete(old._id);
      continue;
    }
    const hasNew = cells.some((c) => c.key === key),
      sources = [
        ...(old?.sources ?? []).filter((s) => s !== id),
        ...(hasNew ? [id] : []),
      ].slice(0, 5);
    const value = {
      ...d.cell,
      dataset_id: datasetId,
      user_id: journal?.user_id ?? previous!.user_id,
      amount,
      count,
      sources,
    };
    if (old) await ctx.db.replace(old._id, value);
    else await ctx.db.insert("agent_finance_cell", value);
  }
  if (cells.length) {
    const value = {
      dataset_id: datasetId,
      user_id: journal!.user_id!,
      journal_id: id,
      cells,
    };
    if (previous) await ctx.db.replace(previous._id, value);
    else await ctx.db.insert("agent_finance_entry", value);
  } else if (previous) await ctx.db.delete(previous._id);
}
