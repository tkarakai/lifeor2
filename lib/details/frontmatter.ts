export type Scalar = string | number | boolean | null;
export interface ParsedDetails {
  /** Always the original source, including malformed front matter and line endings. */
  source: string;
  body: string;
  metadata: Record<string, Scalar>;
  diagnostic: string | null;
}

// Deliberately a small scalar mapping grammar, not a general YAML interpreter.
function scalar(value: string): Scalar {
  if (!value || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    const number = Number(value);
    if (!Number.isFinite(number) || (Number.isInteger(number) && !Number.isSafeInteger(number))) throw new Error("Number exceeds the supported range; quote it as text.");
    return number;
  }
  if (value.startsWith('"')) {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("Expected a quoted string.");
    return parsed;
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(value)) throw new Error("Invalid quoted string.");
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (/^[!&*\[\]{}>|%@`]/.test(value) || /:\s|\s#/.test(value) || /[\r\n]/.test(value)) throw new Error("Only plain or quoted scalar values are supported.");
  return value;
}

export function parseDetails(source: string): ParsedDetails {
  const result: ParsedDetails = { source, body: source, metadata: {}, diagnostic: null };
  const opening = /^(?:\uFEFF)?---\r?\n/.exec(source);
  if (!opening) return result;
  const rest = source.slice(opening[0].length);
  const closing = /^---(?:\r?\n|$)/m.exec(rest);
  if (!closing) return { ...result, diagnostic: "Front matter has no closing --- delimiter; source preserved." };
  try {
    const metadata: Record<string, Scalar> = Object.create(null);
    for (const [index, line] of rest.slice(0, closing.index).split(/\r?\n/).entries()) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const entry = /^([A-Za-z_][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line);
      if (!entry) throw new Error(`Line ${index + 2}: expected a top-level scalar key: value.`);
      if (Object.hasOwn(metadata, entry[1])) throw new Error(`Line ${index + 2}: duplicate key ${entry[1]}.`);
      if (["__proto__", "constructor", "prototype"].includes(entry[1])) throw new Error("Reserved metadata key.");
      metadata[entry[1]] = scalar((entry[2] ?? "").trim());
    }
    return { source, metadata, body: rest.slice(closing.index + closing[0].length), diagnostic: null };
  } catch (error) {
    return { ...result, diagnostic: `${error instanceof Error ? error.message : "Malformed front matter."} Source preserved.` };
  }
}

/** Editing the body retains the original front matter bytes. Malformed input stays raw. */
export function renderDetails(parsed: ParsedDetails, body = parsed.body): string {
  if (parsed.diagnostic) return parsed.source;
  return parsed.source.slice(0, parsed.source.length - parsed.body.length) + body;
}
