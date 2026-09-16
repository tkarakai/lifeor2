import { currencyScales, parseMoney } from "../convex/lib/domain";
export { currencyScales, parseMoney };
/** Format exact minor units without converting a large integer through floating point division. */
export function formatMoney(minorUnits: number, currency: string) {
  if (!Number.isSafeInteger(minorUnits))
    throw new Error("Invalid monetary amount");
  const scale = currencyScales[currency];
  if (scale === undefined) throw new Error(`Unsupported currency: ${currency}`);
  const negative = minorUnits < 0;
  const value = BigInt(Math.abs(minorUnits));
  const factor = 10n ** BigInt(scale);
  const whole = (value / factor).toLocaleString("en-US");
  const fraction = scale
    ? `.${(value % factor).toString().padStart(scale, "0")}`
    : "";
  return `${negative ? "−" : ""}${currency} ${whole}${fraction}`;
}

export function moneyInput(minorUnits: number, currency: string) {
  if (!Number.isSafeInteger(minorUnits))
    throw new Error("Invalid monetary amount");
  const precision = currencyScales[currency];
  if (precision === undefined)
    throw new Error(`Unsupported currency: ${currency}`);
  const value = BigInt(Math.abs(minorUnits));
  const factor = 10n ** BigInt(precision);
  return `${minorUnits < 0 ? "-" : ""}${value / factor}${precision ? `.${(value % factor).toString().padStart(precision, "0")}` : ""}`;
}
