# MCP agent connectivity

LifeOR2 exposes its application operations at `/mcp`, using MCP **2026-07-28** and the official TypeScript SDK **2.0.0**. There is no product CLI. The browser and MCP call the same Convex domain functions and the same Git details service.

## Connect a client

1. Open **Workspace → Agent connections** (`/dashboard/agents`).
2. Register a client name and its exact OAuth callback URL(s). Use HTTPS, or a loopback HTTP address for local development.
3. Copy the client ID, a URL such as `https://life.example/oauth/clients/<id>`. This URL serves the public Client ID Metadata Document. It is not a credential.
4. Start authorization in the user's browser, selecting datasets and permissions.
5. Exchange the returned code with the original PKCE verifier. Keep credentials in the client's secure credential store, outside model context, prompts, command arguments, and logs.
6. Call `/mcp` with the access token in `Authorization: Bearer …`. Start with `datasets.list`.

Only clients registered in LifeOR2 are accepted. Client metadata is hosted by LifeOR2; the authorization server does not fetch arbitrary third-party URLs. This supports the primary client without introducing an SSRF surface or dynamic registration. Register once as a developer; another user can then authorize that client against their own account.

### Discovery and OAuth endpoints

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource/mcp` | Resource URI, authorization server, minimal scopes |
| `/.well-known/oauth-authorization-server` | OAuth metadata, PKCE, issuer validation, token endpoints |
| `/oauth/clients/<id>` | Registered client metadata |
| `/oauth/authorize` | Sign-in and explicit consent |
| `/oauth/token` | Authorization-code exchange and refresh-token rotation |
| `/oauth/revoke` | Revoke the connection associated with an access or refresh token |
| `/mcp` | Authenticated, modern-only Streamable HTTP MCP |

Authorization requests include:

```text
response_type=code
client_id=<registered metadata-document URL>
redirect_uri=<exact registered callback URL>
resource=https://life.example/mcp
scope=data:read data:write
code_challenge=<base64url SHA-256 of verifier>
code_challenge_method=S256
state=<client-generated random state>
```

The callback includes `code`, `state`, and `iss`. The client must validate state and the exact expected issuer before redeeming the code. Cancellation returns `error=access_denied`, with state and issuer, to the validated callback.

Send token requests as `application/x-www-form-urlencoded`:

```text
grant_type=authorization_code
client_id=<same client ID>
code=<returned code>
redirect_uri=<same callback URL>
code_verifier=<original verifier>
resource=https://life.example/mcp
```

For refresh, send `grant_type=refresh_token`, `refresh_token`, `client_id`, and the same `resource`. The response contains a new access token and a new refresh token. Serialize refresh operations: a reused refresh token revokes the entire connection, including already-issued access tokens. Store the replacement atomically. An ambiguous lost refresh response requires fresh browser authorization rather than replaying the old refresh token.

Authorization codes last 5 minutes and are single-use. Access tokens last up to 10 minutes. Connections and refresh credentials have a 30-day absolute lifetime; refresh does not extend consent indefinitely. Revocation takes effect on the next operation, without waiting for token expiry.

### Primary client using SDK v2

The v2 client defaults to the legacy connection sequence unless version negotiation is configured. Pin the protocol explicitly:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client(
  { name: "lifeor-primary-client", version: "1.0.0" },
  {
    versionNegotiation: { mode: { pin: "2026-07-28" } },
    capabilities: { elicitation: { form: {} } },
  },
);

await client.connect(new StreamableHTTPClientTransport(
  new URL("https://life.example/mcp"),
  { authProvider: { token: async () => credentialStore.currentAccessToken() } },
));

const tools = await client.listTools();
const datasets = await client.callTool({ name: "datasets.list", arguments: {} });
```

`credentialStore` is client-owned pseudocode. Implement browser OAuth, secure storage, serialized refresh and reauthorization there. Register the client's `elicitation/create` handler to present confirmations to the user; never automatically accept an irreversible operation. The SDK handles `input_required` and retries through its multi-round-trip machinery.

There is no `initialize` handshake or transport session. Each request carries the version/capabilities metadata and routing headers. `server/discover` and `tools/list` return private 60-second cache hints. Do not share tool catalogs between different grants. Results use `resultType: "complete"`, `structuredContent`, and a JSON text representation. Permanent deletion uses `resultType: "input_required"` and form elicitation, bound to a hash of that call's arguments. Server-side permission and dependency checks still apply; client confirmation is not an authentication boundary.

The server does not advertise Tasks, sampling, MCP Apps, or subscriptions. These are not required for the synchronous operations implemented here. Browser updates use Convex subscriptions independently of MCP.

## Operations and permissions

### Focused model entry surface

`agentQueries.searchEntities` and `agentQueries.incomeSummary` carry `_meta["lifeor2/primary"] = true` in discovery. Clients can expose these small typed reads directly to a model while keeping the rest of the grant-filtered catalog behind discovery. The hint does not change scopes, dataset checks, or the callable MCP names. The Pi client uses the discovered schemas, supplies its bound dataset, and routes direct calls through its normal validation/audit path.

Income month arguments explicitly identify inclusive endpoints in `YYYY-MM` format; `chartId` is an optional narrowing filter. Income results distinguish `recorded_income` from `no_recorded_income`. The latter is a completed search without attributable records, not proof of zero real earnings. An empty currencies array supplies neither an average nor a currency to report. Source IDs, exclusions, gross-income basis and dataset-completeness limitations remain part of the result.

The full-access catalog currently has **113 tools**: 102 domain operations, six dataset operations and five Markdown operations. Discovery returns only tools permitted by the connection's scopes. The authenticated backend independently enforces the same scope for every execution, including direct calls to Convex.

| Scope | Meaning |
| --- | --- |
| `data:read` | Read authorized datasets, records, history, financial reports and Markdown. Required for every connection. |
| `data:write` | Create/edit ordinary records, archive/restore, planning, tags, evidence and Markdown. |
| `finance:write` | Accounts, charts, journals, cash routing, obligations, settlements, observations and reconciliation. |
| `data:delete` | Permanently delete archived records after dependency checks. |
| `datasets:manage` | Create datasets, prepare/resume authorized samples, populate their months and select the UI dataset. Newly created datasets are added to this grant. |

Every domain operation requires an explicit authorized `datasetId`; the browser's active dataset never implicitly selects an agent's target. `datasets.list` returns only the grant's datasets. Creating a new dataset requires explicit dataset-management consent. Resuming an existing sample requires that dataset already be authorized.

The tool inventory covers UI domain operations: entities, arrangements, types, roles, ownership, events, measurements, tags, finance, obligations, planning, trash and Markdown. It excludes Observatory rendering, authentication/account administration, database migrations and backend operator functions. Domain validation and financial invariants remain in Convex. There is no arbitrary table-write, SQL, filesystem or shell tool.

### Writes, concurrency and audit

- Convex writes require `requestKey`, a unique 16–128 character identifier (UUID recommended). Reuse it only for exactly the same operation, dataset and arguments. The write, replay result and audit entry commit in one transaction. A reused key with different arguments fails.
- Revision-aware operations require `expectedRevision` for agent writes, even when the browser API permits it to be omitted. Read the current revision first. Existing non-versioned operations retain their domain validation and Convex transaction conflict handling; they do not gain a universal record-version contract.
- Markdown saves require `expectedCommit` from `details.read`. Git provides compare-and-swap protection and identical-source retry semantics. Sample-note creation skips existing documents. These operations use those existing retry mechanisms instead of a request key.
- Git and Convex are not one atomic transaction. A committed document with a failed metadata update returns the existing pending-cache warning; retrying repairs the cache without another commit. The Git history records the agent connection in its author, while Convex records details locator/cache mutations in the activity ledger.
- The connection activity page shows successful writes and their originating connection. This is not a complete read-access or rejected-request audit log.
- Credentials and OAuth tables are excluded from business datasets, migration scans and trash dependency traversal. Token and authorization-code secrets are stored only as SHA-256 hashes. MCP token material is injected by the server adapter and never appears in tool schemas or results.
- The application uses ordinary user-scoped Convex calls with explicit agent-token verification, not admin credentials or a broadly privileged service account. The adapter passes the token to the Convex boundary; do not log Convex argument envelopes.

## Realtime behavior

An MCP mutation invalidates the same Convex queries as a UI mutation. Another browser signed in as the same user and viewing the affected dataset updates without refresh, even on another computer. Different datasets and different users remain isolated.

The Markdown editor subscribes to its Convex document locator. When a new Git commit is observed, a clean editor reloads the source; a dirty editor preserves its draft and shows a conflict notice. It never silently replaces unsaved text. HTTP request cancellation also prevents an obsolete response from replacing a newer editor state.

The live integration test verifies this with two independent browser contexts and HTTP MCP writes, including both clean and dirty Markdown editors.

## Deployment

The local endpoint is `http://localhost:3000/mcp`. A client on another machine needs a reachable deployment; its `localhost` is not this machine.

- Set frontend `NEXT_PUBLIC_SITE_URL` and Convex `SITE_URL` to the **same canonical HTTPS origin without a trailing slash**. That origin is the issuer, callback-metadata host and base of the resource audience. Changing it requires clients to reconnect.
- Set frontend Convex URLs to the same backend used by all browsers. Do not deploy independent databases per computer.
- Serve the existing Git details repository on durable storage accessible to the app server. All app instances must use the same repository and a filesystem supporting its exclusive writer lock and atomic Git ref update, or run one document-writing instance. Stateless MCP does not make local Git storage distributed. Back up Git and Convex together.
- Configure Convex `RESEND_API_KEY` and `AUTH_EMAIL_FROM` for real login email delivery. Without these, mock email is allowed only with a loopback HTTP `SITE_URL`; remote login fails closed. No email provider secrets belong in frontend `NEXT_PUBLIC_*` variables.
- Native and backend clients can connect without an Origin header. Browser clients on another origin need that exact origin in frontend `MCP_ALLOWED_ORIGINS` (comma-separated, no wildcard). This enables bearer-authenticated CORS for MCP/token/revocation endpoints, never cross-origin cookie-based consent. Public discovery/client metadata is readable cross-origin.
- Requests must use the configured canonical host. Configure the deployment/reverse proxy accordingly. No forwarded host header is trusted to choose an issuer or redirect destination.
- Authenticated MCP requests are limited to 120 per minute per connection using Convex-backed counters; exceeded limits return HTTP 429 and `Retry-After`. Apply infrastructure limits to unauthenticated traffic and tune deployment capacity for the actual workload. Domain lists currently inherit the UI's bounded-by-Convex collection behavior; large-data pagination remains a scaling consideration.
- Treat OAuth tokens as secrets in infrastructure logs. Do not log authorization headers, token request/response bodies or authorization callback query strings.

## Development and validation

`bun run mcp:catalog` generates the checked-in tool schemas from the explicitly opted-in Convex functions. The generator never invokes a domain handler. `bun run mcp:check` fails if the catalog is stale. When adding an operation, assign its backend policy, add it to the reviewed catalog module inventory if necessary, regenerate schemas, and add domain/security coverage.

```sh
bun run typecheck
bun run test
bun run mcp:check
bun run build
# With the local frontend and backend running:
bun run test:mcp:live
```

The live check creates a separate `mcp-check-…@example.invalid` account in the local database, exercises actual browser consent, OAuth, SDK v2 discovery, external writes and realtime updates, saves screenshots under `.convex/mcp-check`, and revokes its connection afterward. It leaves its isolated fixture records for inspection. It refuses non-loopback deployments.

Protocol references: [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [Resend email API](https://resend.com/docs/api-reference/emails/send-email).
