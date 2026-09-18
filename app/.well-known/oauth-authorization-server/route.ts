import { appOrigin, json } from "@/lib/mcp/http";
import { AGENT_SCOPES } from "@/lib/agent-contract";
export function GET() {
  const issuer = appOrigin();
  return json({ issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"],
    scopes_supported: AGENT_SCOPES, authorization_response_iss_parameter_supported: true, client_id_metadata_document_supported: true }, 200, { "Access-Control-Allow-Origin": "*" });
}
