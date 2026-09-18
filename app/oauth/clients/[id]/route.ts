import { api } from "@/convex/_generated/api";
import { appOrigin, backend, json } from "@/lib/mcp/http";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await backend().query(api.agents.clientMetadata, { clientId: `${appOrigin()}/oauth/clients/${id}` });
  return result ? json(result, 200, { "Access-Control-Allow-Origin": "*" }) : json({ error: "invalid_client" }, 404);
}
