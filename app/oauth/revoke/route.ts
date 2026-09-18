import { api } from "@/convex/_generated/api";
import { agentPreflight, withAgentCors, backend, boundedBody, checkOrigin, json } from "@/lib/mcp/http";
async function handle(request: Request) {
  try {
    checkOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return json({ error: "invalid_request" }, 400);
    const form = new URLSearchParams(await boundedBody(request, 16384));
    await backend().mutation(api.agents.revokeToken, { token: form.get("token") ?? "", clientId: form.get("client_id") ?? "" });
    return json({});
  } catch { return json({ error: "invalid_request" }, 400); }
}

export const POST = (request: Request) => withAgentCors(request, () => handle(request));
export const OPTIONS = agentPreflight;
