import { api } from "@/convex/_generated/api";
import { AGENT_SCOPES, digest } from "@/lib/agent-contract";
import { appOrigin, backend, boundedBody, browserAuth, checkOrigin, json, newSecret, resourceUrl } from "@/lib/mcp/http";
export async function POST(request: Request) {
  try {
    checkOrigin(request, true);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "invalid_request" }, 400);
    const body = JSON.parse(await boundedBody(request, 16384));
    const params = new URLSearchParams(body.authorization);
    const clientId = params.get("client_id") ?? "", redirectUri = params.get("redirect_uri") ?? "";
    const client = await backend().query(api.agents.clientMetadata, { clientId });
    if (!client || !client.redirect_uris.includes(redirectUri)) return json({ error: "invalid_client" }, 400);
    if (params.get("response_type") !== "code" || params.get("code_challenge_method") !== "S256" || params.get("resource") !== resourceUrl()) return json({ error: "invalid_request" }, 400);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "")) return json({ error: "invalid_request" }, 400);
    for (const key of params.keys()) if (params.getAll(key).length !== 1) return json({ error: "invalid_request" }, 400);
    const requested = (params.get("scope") ?? "data:read").split(" ").filter(Boolean);
    if (requested.some(s => !AGENT_SCOPES.includes(s as never))) return json({ error: "invalid_scope" }, 400);
    const destination = new URL(redirectUri); destination.searchParams.set("iss", appOrigin());
    if (params.has("state")) destination.searchParams.set("state", params.get("state")!);
    if (body.approve !== true) { destination.searchParams.set("error", "access_denied"); return json({ redirect: destination.href }); }
    if (!Array.isArray(body.scopes) || body.scopes.some((s: string) => !requested.includes(s))) return json({ error: "invalid_scope" }, 400);
    const code = newSecret("lor_code_");
    await browserAuth().fetchAuthMutation(api.agents.authorize, { clientId, redirectUri, resource: resourceUrl(),
      challenge: params.get("code_challenge")!, scopes: body.scopes, datasetIds: body.datasetIds, codeHash: digest(code) });
    destination.searchParams.set("code", code);
    return json({ redirect: destination.href });
  } catch { return json({ error: "invalid_request", message: "Unable to authorize. Sign in and check the selected datasets and permissions." }, 400); }
}
