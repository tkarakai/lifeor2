import { api } from "@/convex/_generated/api";
import { digest } from "@/lib/agent-contract";
import { agentPreflight, withAgentCors, backend, boundedBody, checkOrigin, json, newSecret } from "@/lib/mcp/http";
async function handle(request: Request) {
  try {
    checkOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return json({ error: "invalid_request" }, 400);
    const form = new URLSearchParams(await boundedBody(request, 16384));
    for (const key of form.keys()) if (form.getAll(key).length !== 1) return json({ error: "invalid_request" }, 400);
    const grantType = form.get("grant_type");
    if (grantType !== "authorization_code" && grantType !== "refresh_token") return json({ error: "unsupported_grant_type" }, 400);
    const access = newSecret("lor_at_"), refresh = newSecret("lor_rt_");
    const result = await backend().mutation(api.agents.exchange, { grantType, credential: form.get(grantType === "authorization_code" ? "code" : "refresh_token") ?? "",
      clientId: form.get("client_id") ?? "", resource: form.get("resource") ?? "", ...(grantType === "authorization_code" ? { redirectUri: form.get("redirect_uri") ?? "", verifier: form.get("code_verifier") ?? "" } : {}),
      accessHash: digest(access), refreshHash: digest(refresh) });
    if (result.error) return json({ error: result.error }, 400);
    return json({ access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: result.expiresIn, scope: result.scope });
  } catch { return json({ error: "invalid_request" }, 400); }
}

export const POST = (request: Request) => withAgentCors(request, () => handle(request));
export const OPTIONS = agentPreflight;
