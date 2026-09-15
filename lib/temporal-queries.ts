/**
 * Temporal Query Helpers
 *
 * Utilities for querying data with temporal validity (valid_from, valid_to)
 */

export interface TemporalRecord {
  valid_from: number;
  valid_to?: number;
}

/**
 * Filter records that are valid at a specific timestamp
 *
 * A record is valid at timestamp T if:
 * - valid_from <= T
 * - valid_to is null (open-ended) OR valid_to >= T
 */
export function filterByValidTime<T extends TemporalRecord>(
  items: T[],
  asOf: number
): T[] {
  return items.filter(
    (item) => item.valid_from <= asOf && (!item.valid_to || item.valid_to >= asOf)
  );
}

/**
 * Filter records that overlap with a time range [start, end]
 *
 * A record overlaps with [start, end] if:
 * - valid_from < end (starts before range ends)
 * - valid_to is null (open-ended) OR valid_to > start (ends after range starts)
 */
export function filterByTimeRange<T extends TemporalRecord>(
  items: T[],
  start: number,
  end: number
): T[] {
  return items.filter(
    (item) => item.valid_from < end && (!item.valid_to || item.valid_to > start)
  );
}

/**
 * Get the most recent version of a record at a given timestamp
 * Useful when records supersede each other
 */
export function getMostRecent<T extends TemporalRecord>(
  items: T[],
  asOf: number
): T | null {
  const validItems = filterByValidTime(items, asOf);
  if (validItems.length === 0) return null;

  // Return the one with the latest valid_from
  return validItems.reduce((latest, current) =>
    current.valid_from > latest.valid_from ? current : latest
  );
}

/**
 * Check if a record is currently valid (valid_to is null or in the future)
 */
export function isCurrentlyValid<T extends TemporalRecord>(item: T): boolean {
  const now = Date.now();
  return item.valid_from <= now && (!item.valid_to || item.valid_to >= now);
}

/**
 * Check if a record is expired (valid_to is in the past)
 */
export function isExpired<T extends TemporalRecord>(item: T): boolean {
  if (!item.valid_to) return false; // Open-ended records never expire
  return item.valid_to < Date.now();
}

/**
 * Get all historical versions of records, sorted by valid_from (oldest first)
 */
export function sortByValidFrom<T extends TemporalRecord>(items: T[]): T[] {
  return [...items].sort((a, b) => a.valid_from - b.valid_from);
}

/**
 * Get the timeline of a record (all versions over time)
 * Assumes records are linked via a supersedes relationship
 */
export function buildTimeline<T extends TemporalRecord>(
  items: T[],
  startItem: T
): T[] {
  const timeline = [startItem];
  let current = startItem;

  // This is a simplified version - in practice you'd follow supersedes_arrangement_id
  // For now, just sort all items by valid_from
  return sortByValidFrom(items);
}

/**
 * Format a timestamp as ISO date string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

/**
 * Parse an ISO date string to Unix timestamp
 */
export function parseDate(dateString: string): number {
  return new Date(dateString).getTime();
}

/**
 * Get the current Unix timestamp
 */
export function now(): number {
  return Date.now();
}
