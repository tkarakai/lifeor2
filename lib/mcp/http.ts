import { randomBytes } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { ConvexError } from "convex/values";

export function appOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value || new URL(value).origin !== value) throw new Error("Configure NEXT_PUBLIC_SITE_URL as the canonical app origin.");
  const u = new URL(value);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname))) throw new Error("Remote agent access requires HTTPS.");
  return value;
}
export const resourceUrl = () => `${appOrigin()}/mcp`;
export const newSecret = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;
export function backend() { return new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!); }
export function browserAuth() { return convexBetterAuthNextJs({ convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!, convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL! }); }
export function json(value: unknown, status = 200, extra?: HeadersInit) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff", ...extra } });
}
export function checkOrigin(request: Request, require = false) {
  if (new URL(request.url).origin !== appOrigin()) throw new Error("untrusted_host");
  const origin = request.headers.get("origin");
  const permitted = require ? [appOrigin()] : allowedOrigins();
  if ((require && !origin) || (origin && !permitted.includes(origin)) || (require && request.headers.get("sec-fetch-site") === "cross-site")) throw new Error("untrusted_origin");
}
function allowedOrigins() {
  return [appOrigin(), ...(process.env.MCP_ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean)];
}
export async function withAgentCors(request: Request, operation: () => Promise<Response>) {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins().includes(origin)) return json({ error: "untrusted_origin" }, 403);
  const response = await operation();
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, Retry-After, MCP-Protocol-Version");
    response.headers.append("Vary", "Origin");
  }
  return response;
}
export function agentPreflight(request: Request) {
  return withAgentCors(request, async () => {
    try { checkOrigin(request); } catch { return json({ error: "untrusted_origin" }, 403); }
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Method, Mcp-Name, MCP-Protocol-Version",
      "Access-Control-Max-Age": "600", "Cache-Control": "no-store",
    } });
  });
}
export async function boundedBody(request: Request, max = 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > max) { await reader.cancel(); throw new Error("request_too_large"); } chunks.push(part.value); }
  return Buffer.concat(chunks).toString("utf8");
}
export function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof ConvexError && error.data && typeof error.data === "object" && "code" in error.data && "message" in error.data)
    return { code: String(error.data.code), message: String(error.data.message) };
  const raw = error instanceof Error ? error.message : "";
  // Convex wraps ordinary domain errors; return the validation message only,
  // never its request identifier, stack, function path, or transport body.
  const domain = raw.match(/Uncaught Error: ([^\n]+)/)?.[1];
  if (domain && !/secret|configuration|environment|fetch|internal/i.test(domain)) return { code: /Revision conflict/.test(domain) ? "revision_conflict" : "operation_failed", message: domain };
  return { code: "operation_failed", message: "The operation failed. Check the arguments and permissions, then retry with the same requestKey." };
}
