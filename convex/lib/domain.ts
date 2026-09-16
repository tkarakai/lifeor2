/** Exact, dependency-free domain invariants shared by mutations and fixtures. */
export const currencyScales: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  HUF: 2,
  JPY: 0,
  KWD: 3,
  BHD: 3,
};
export function scale(currency: string) {
  const value = currencyScales[currency];
  if (value === undefined) throw new Error(`Unsupported currency: ${currency}`);
  return value;
}
export function integer(value: number) {
  if (!Number.isSafeInteger(value))
    throw new Error("Amount must be a safe integer in minor units");
  return value;
}
export function add(...values: number[]) {
  return values.reduce((a, b) => integer(a + integer(b)), 0);
}
export function money(value: number, currency: string) {
  scale(currency);
  return integer(value);
}
export function decimal(value: string) {
  if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new Error("Invalid exact decimal");
  return value;
}
export function parseMoney(value: string, currency: string) {
  decimal(value);
  const precision = scale(currency);
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision)))
    throw new Error("Unsupported monetary precision; no rounding allowed");
  const result =
    BigInt(whole) * 10n ** BigInt(precision) +
    BigInt(fraction.slice(0, precision).padEnd(precision, "0") || "0");
  return integer(Number(negative ? -result : result));
}
export function nonempty(value: string) {
  if (!value.trim()) throw new Error("Name must not be empty");
  return value.trim();
}
export function instant(value: number) {
  if (!Number.isFinite(value)) throw new Error("Invalid instant");
  return value;
}
export function period(from: number, to?: number) {
  instant(from);
  if (to !== undefined && instant(to) <= from)
    throw new Error("End date must follow start date");
}
export function date(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
  )
    throw new Error("Invalid calendar date");
  return value;
}
export function timezone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
  } catch {
    throw new Error("Invalid timezone");
  }
}
export type Segment<T> = { valid_from: number; valid_to?: number; facts: T };
export function validateTimeline<T>(segments: Segment<T>[]) {
  if (!segments.length) throw new Error("Timeline cannot be empty");
  let end = -Infinity;
  for (const s of segments) {
    period(s.valid_from, s.valid_to);
    if (s.valid_from < end) throw new Error("Overlapping timeline");
    end = s.valid_to ?? Infinity;
  }
}
export function changeTimeline<T>(
  segments: Segment<T>[],
  effectiveAt: number,
  facts: T,
): Segment<T>[] {
  instant(effectiveAt);
  const next: Segment<T>[] = [];
  let found = false;
  for (const s of segments) {
    if (
      s.valid_from <= effectiveAt &&
      (s.valid_to === undefined || effectiveAt < s.valid_to)
    ) {
      if (s.valid_from < effectiveAt)
        next.push({ ...s, valid_to: effectiveAt });
      next.push({ ...s, valid_from: effectiveAt, facts });
      found = true;
    } else next.push(s);
  }
  if (!found) throw new Error("Effective time is outside timeline");
  validateTimeline(next);
  return next;
}
export function selectRevision<
  T extends {
    recorded_at: number;
    revision: number;
    segments: Segment<unknown>[];
  },
>(revisions: T[], effectiveAt: number, knownAt: number) {
  const revision = revisions
    .filter((r) => r.recorded_at <= knownAt)
    .sort(
      (a, b) => b.recorded_at - a.recorded_at || b.revision - a.revision,
    )[0];
  return (
    revision?.segments.find(
      (s) =>
        s.valid_from <= effectiveAt &&
        (s.valid_to === undefined || effectiveAt < s.valid_to),
    ) ?? null
  );
}
export function partition(total: number, amounts: number[]) {
  integer(total);
  if (
    !amounts.length ||
    amounts.some(
      (n) =>
        !Number.isSafeInteger(n) ||
        n === 0 ||
        Math.sign(n) !== Math.sign(total) ||
        Math.abs(n) > Math.abs(total),
    ) ||
    add(...amounts) !== total
  )
    throw new Error("Amounts must partition the posting exactly with its sign");
}
/** Largest remainder; ties use stable entity ID (unassigned sorts last). */
export function allocate(
  total: number,
  shares: { key: string; bps: number }[],
) {
  integer(total);
  if (
    !shares.length ||
    shares.some((s) => !Number.isInteger(s.bps) || s.bps < 0) ||
    shares.reduce((s, x) => s + x.bps, 0) !== 10000 ||
    new Set(shares.map((s) => s.key)).size !== shares.length
  )
    throw new Error(
      "Beneficiary shares must uniquely partition 10000 basis points",
    );
  const magnitude = BigInt(Math.abs(total));
  const rows = shares.map((s) => ({
    ...s,
    amount: Number((magnitude * BigInt(s.bps)) / 10000n),
    remainder: (magnitude * BigInt(s.bps)) % 10000n,
  }));
  let left = Math.abs(total) - add(...rows.map((r) => r.amount));
  const ordered = [...rows].sort(
    (a, b) =>
      Number(b.remainder - a.remainder) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  for (const row of ordered) if (left-- > 0) row.amount++;
  return rows.map((r) => ({
    key: r.key,
    minor_units: r.amount * Math.sign(total),
  }));
}

/** Overlay an effective interval, preserving both unaffected sides and gaps. */
export function overlayTimeline<T>(
  segments: Segment<T>[],
  from: number,
  to: number | undefined,
  facts: T,
): Segment<T>[] {
  period(from, to);
  const end = to ?? Infinity;
  const next: Segment<T>[] = [];
  for (const old of segments) {
    const oldEnd = old.valid_to ?? Infinity;
    if (oldEnd <= from || old.valid_from >= end) {
      next.push(old);
      continue;
    }
    if (old.valid_from < from) next.push({ ...old, valid_to: from });
    if (oldEnd > end) next.push({ ...old, valid_from: end });
  }
  next.push({ valid_from: from, valid_to: to, facts });
  next.sort((a, b) => a.valid_from - b.valid_from);
  validateTimeline(next);
  return next;
}
