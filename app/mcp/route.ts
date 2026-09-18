import { handleMcp } from "@/lib/mcp/server";
import { withAgentCors, agentPreflight } from "@/lib/mcp/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => withAgentCors(request, () => handleMcp(request));
export const GET = POST;
export const DELETE = POST;
export const OPTIONS = agentPreflight;
