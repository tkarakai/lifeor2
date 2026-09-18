// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  grant: {
    connectionId: "connection",
    userId: "user",
    clientId: "http://localhost:3000/oauth/clients/client",
    scopes: [
      "data:read",
      "data:write",
      "finance:write",
      "data:delete",
      "datasets:manage",
    ],
    datasetIds: ["dataset"],
  },
}));
vi.mock("../lib/mcp/http", async (original) => ({
  ...(await original<object>()),
  backend: () => ({ query: mocks.query, mutation: mocks.mutation }),
}));
import { handleMcp } from "../lib/mcp/server";
import { GET as metadata } from "../app/.well-known/oauth-authorization-server/route";
import { OPTIONS as preflight, POST as corsMcp } from "../app/mcp/route";
const token = "lor_at_" + "a".repeat(43);
function request(
  method: string,
  params: Record<string, unknown> = {},
  extra: Record<string, string> = {},
  meta: Record<string, unknown> = {},
) {
  return new Request("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(typeof params.name === "string" ? { "Mcp-Name": params.name } : {}),
      ...extra,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
          ...meta,
        },
      },
    }),
  });
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
  mocks.query.mockReset();
  mocks.mutation.mockReset();
  mocks.grant.scopes = [
    "data:read",
    "data:write",
    "finance:write",
    "data:delete",
    "datasets:manage",
  ];
  mocks.query.mockImplementation(async (ref) =>
    getFunctionName(ref) === "agents:authenticate" ? mocks.grant : [],
  );
  mocks.mutation.mockImplementation(async (ref) =>
    getFunctionName(ref) === "agents:admitRequest"
      ? { allowed: true }
      : "new-record",
  );
});
test("OAuth discovery advertises PKCE, issuer validation and client metadata documents", async () => {
  const value = await metadata().json();
  expect(value).toMatchObject({
    issuer: "http://localhost:3000",
    authorization_response_iss_parameter_supported: true,
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  });
});
test("MCP is authenticated, origin restricted, modern-only and checks routing headers", async () => {
  const unauth = await handleMcp(
    request("tools/list", {}, { Authorization: "" }),
  );
  expect(unauth.status).toBe(401);
  expect(unauth.headers.get("www-authenticate")).toContain(
    "oauth-protected-resource/mcp",
  );
  expect(
    (
      await handleMcp(
        request("tools/list", {}, { Origin: "https://evil.example" }),
      )
    ).status,
  ).toBe(403);
  const legacy = new Request("http://localhost:3000/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "old", version: "1" },
      },
    }),
  });
  expect((await handleMcp(legacy)).status).toBe(400);
  expect(
    (await handleMcp(request("tools/list", {}, { "Mcp-Method": "tools/call" })))
      .status,
  ).toBe(400);
});
test("current MCP discovery and tool listing work without initialization and use private cache hints", async () => {
  const discovery = await handleMcp(request("server/discover"));
  expect(discovery.status).toBe(200);
  const info = await discovery.json();
  expect(info.result.resultType).toBe("complete");
  const response = await handleMcp(request("tools/list"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body = await response.json();
  expect(body.error).toBeUndefined();
  expect(body.result).toMatchObject({
    resultType: "complete",
    cacheScope: "private",
    ttlMs: 60000,
  });
  const names = body.result.tools.map((t: { name: string }) => t.name);
  expect(names).toContain("entities.create");
  expect(names).toContain("details.save");
  expect(names).toContain("datasets.prepareSample");
  expect(names).not.toContain("insights.snapshot");
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(
    body.result.tools
      .filter(
        (t: { _meta?: Record<string, unknown> }) =>
          t._meta?.["lifeor2/primary"],
      )
      .map((t: { name: string }) => t.name),
  ).toEqual([
    "life.context",
    "life.events",
    "life.relationships",
    "life.search",
    "life.timeline",
    "reports.cashProjection",
    "reports.commitment",
    "reports.commitmentScenario",
    "reports.comparePeriods",
    "reports.finances",
    "reports.project",
  ]);
  expect(JSON.stringify(body)).not.toContain("agentToken");
});
test("read-only discovery hides writes and direct tool calls return a scope challenge", async () => {
  mocks.grant.scopes = ["data:read"];
  const body = await (await handleMcp(request("tools/list"))).json();
  expect(
    body.result.tools.some(
      (t: { name: string }) => t.name === "entities.create",
    ),
  ).toBe(false);
  const denied = await handleMcp(
    request("tools/call", { name: "entities.create", arguments: {} }),
  );
  expect(denied.status).toBe(403);
  const appendDenied = await handleMcp(
    request("tools/call", { name: "details.append", arguments: {} }),
  );
  expect(appendDenied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain(
    'scope="data:write"',
  );
});
test("missing report handles return a recoverable scoped error without filesystem details", async () => {
  const body = await (await handleMcp(request("tools/call", {
    name: "reports.read", arguments: { datasetId: "dataset", reportId: "00000000-0000-0000-0000-000000000000" },
  }))).json();
  expect(body.result.isError).toBe(true);
  expect(body.result.structuredContent.error).toMatchObject({ code: "report_unavailable" });
  expect(body.result.structuredContent.error.message).toContain("fresh report");
  expect(JSON.stringify(body)).not.toContain(".convex/");
});
test("tool calls validate schemas and inject credentials outside model arguments", async () => {
  const bad = await (
    await handleMcp(
      request("tools/call", {
        name: "entities.create",
        arguments: { kind: "Person" },
      }),
    )
  ).json();
  expect(bad.result?.isError || bad.error).toBeTruthy();
  expect(
    mocks.mutation.mock.calls.some(
      ([ref]) => getFunctionName(ref) === "entities:create",
    ),
  ).toBe(false);
  const args = {
    datasetId: "dataset",
    requestKey: "write-request-0001",
    kind: "Person",
    display_name: "MCP",
  };
  const body = await (
    await handleMcp(
      request("tools/call", { name: "entities.create", arguments: args }),
    )
  ).json();
  expect(body.result).toMatchObject({
    resultType: "complete",
    structuredContent: "new-record",
  });
  expect(
    mocks.mutation.mock.calls.find(
      ([ref]) => getFunctionName(ref) === "entities:create",
    )?.[1],
  ).toEqual({ ...args, agentToken: token });
  const spoof = await (
    await handleMcp(
      request("tools/call", {
        name: "entities.create",
        arguments: { ...args, agentToken: "other" },
      }),
    )
  ).json();
  expect(spoof.result?.isError || spoof.error).toBeTruthy();
});
test("permanent deletion requests confirmation through stateless multi-round-trip elicitation", async () => {
  mocks.query.mockImplementation(async (ref) =>
    getFunctionName(ref) === "agents:authenticate"
      ? mocks.grant
      : { name: "Old entity", recordCount: 2, blockers: [] },
  );
  const params = {
    name: "trash.permanentlyDelete",
    arguments: {
      datasetId: "dataset",
      requestKey: "delete-request-01",
      target: { kind: "entity", id: "entity" },
    },
  };
  const meta = {
    "io.modelcontextprotocol/clientCapabilities": { elicitation: { form: {} } },
  };
  const body = await (
    await handleMcp(request("tools/call", params, {}, meta))
  ).json();
  expect(body.result.resultType).toBe("input_required");
  expect(
    mocks.mutation.mock.calls.some(
      ([ref]) => getFunctionName(ref) === "trash:permanentlyDelete",
    ),
  ).toBe(false);
  expect(JSON.stringify(body.result.inputRequests)).toContain("Old entity");
  const key = Object.keys(body.result.inputRequests)[0];
  const inputResponses = {
    [key]: {
      resultType: "complete",
      action: "accept",
      content: { confirmation: "DELETE" },
    },
  };
  const changed = await (
    await handleMcp(
      request(
        "tools/call",
        {
          ...params,
          arguments: { ...params.arguments, requestKey: "changed-delete-01" },
          inputResponses,
        },
        {},
        meta,
      ),
    )
  ).json();
  expect(changed.result.isError).toBe(true);
  expect(
    mocks.mutation.mock.calls.some(
      ([ref]) => getFunctionName(ref) === "trash:permanentlyDelete",
    ),
  ).toBe(false);
  const confirmed = await (
    await handleMcp(
      request("tools/call", { ...params, inputResponses }, {}, meta),
    )
  ).json();
  expect(confirmed.result.resultType).toBe("complete");
  expect(
    mocks.mutation.mock.calls.find(
      ([ref]) => getFunctionName(ref) === "trash:permanentlyDelete",
    )?.[1],
  ).toMatchObject({ ...params.arguments, confirmation: "DELETE" });
});
test("browser clients require an explicit origin allowlist and malformed tool names are rejected", async () => {
  const origin = "https://client.example";
  const options = () =>
    new Request("http://localhost:3000/mcp", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });
  expect((await preflight(options())).status).toBe(403);
  vi.stubEnv("MCP_ALLOWED_ORIGINS", origin);
  expect((await preflight(options())).status).toBe(204);
  const response = await corsMcp(request("tools/list", {}, { Origin: origin }));
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  const malformed = await handleMcp(
    request("tools/call", { name: 42, arguments: {} }),
  );
  expect((await malformed.json()).error).toBeTruthy();
});
test("an exhausted connection receives Retry-After rather than executing a tool", async () => {
  mocks.mutation.mockResolvedValue({ allowed: false });
  const response = await handleMcp(request("tools/list"));
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
});
