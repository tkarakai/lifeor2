/** Half-open effective intervals; knowledge-time revisions are immutable snapshots. */
export interface TemporalRecord {
  valid_from: number;
  valid_to?: number;
}
export function filterByValidTime<T extends TemporalRecord>(
  items: T[],
  asOf: number,
): T[] {
  return items.filter(
    (x) =>
      x.valid_from <= asOf && (x.valid_to === undefined || asOf < x.valid_to),
  );
}
export function filterByTimeRange<T extends TemporalRecord>(
  items: T[],
  start: number,
  end: number,
): T[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
    throw new Error("Invalid half-open range");
  return items.filter(
    (x) =>
      x.valid_from < end && (x.valid_to === undefined || x.valid_to > start),
  );
}
export function getMostRecent<T extends TemporalRecord>(
  items: T[],
  asOf: number,
): T | null {
  return (
    filterByValidTime(items, asOf).sort(
      (a, b) => b.valid_from - a.valid_from,
    )[0] ?? null
  );
}
export function isCurrentlyValid<T extends TemporalRecord>(item: T): boolean {
  return filterByValidTime([item], Date.now()).length === 1;
}
export function isExpired<T extends TemporalRecord>(item: T): boolean {
  return item.valid_to !== undefined && item.valid_to <= Date.now();
}
export function sortByValidFrom<T extends TemporalRecord>(items: T[]): T[] {
  return [...items].sort((a, b) => a.valid_from - b.valid_from);
}
export interface LineageRecord extends TemporalRecord {
  _id?: string;
  root_id?: string;
  supersedes_arrangement_id?: string;
}
/** Follow only connected predecessors/successors; never mix unrelated identities. */
export function buildTimeline<T extends LineageRecord>(
  items: T[],
  startItem: T,
): T[] {
  if (startItem.root_id)
    return sortByValidFrom(
      items.filter((x) => x.root_id === startItem.root_id),
    );
  if (!startItem._id) return [startItem];
  const ids = new Set([startItem._id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const x of items) {
      if (!x._id) continue;
      if (
        ids.has(x._id) &&
        x.supersedes_arrangement_id &&
        !ids.has(x.supersedes_arrangement_id)
      ) {
        ids.add(x.supersedes_arrangement_id);
        changed = true;
      }
      if (
        x.supersedes_arrangement_id &&
        ids.has(x.supersedes_arrangement_id) &&
        !ids.has(x._id)
      ) {
        ids.add(x._id);
        changed = true;
      }
    }
  }
  return sortByValidFrom(items.filter((x) => x._id && ids.has(x._id)));
}
export function selectAsKnown<T>(
  revisions: {
    root_id: string;
    revision: number;
    recorded_at: number;
    segments: (TemporalRecord & { facts: T })[];
  }[],
  rootId: string,
  effectiveAt: number,
  knownAt: number,
): T | null {
  const revision = revisions
    .filter((r) => r.root_id === rootId && r.recorded_at <= knownAt)
    .sort(
      (a, b) => b.recorded_at - a.recorded_at || b.revision - a.revision,
    )[0];
  return revision
    ? (filterByValidTime(revision.segments, effectiveAt)[0]?.facts ?? null)
    : null;
}
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}
export function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Invalid calendar date");
  const parsed = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(parsed) || formatTimestamp(parsed) !== value)
    throw new Error("Invalid calendar date");
  return parsed;
}
export function now(): number {
  return Date.now();
}
