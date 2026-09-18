import { appOrigin, resourceUrl, json } from "@/lib/mcp/http";
export function GET() { return json({ resource: resourceUrl(), authorization_servers: [appOrigin()], scopes_supported: ["data:read"], bearer_methods_supported: ["header"], resource_name: "LifeOR2" }, 200, { "Access-Control-Allow-Origin": "*" }); }
