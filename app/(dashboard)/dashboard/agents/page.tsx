"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useDataset } from "@/lib/dataset";
import { AGENT_SCOPE_LABELS } from "@/lib/agent-contract";
import { Page, Panel, Action, Editor, Form, TextField, textValue } from "@/components/record-ui";

export default function AgentsPage() {
  const result = useQuery(api.agents.connections, {});
  const register = useMutation(api.agents.registerClient), revoke = useMutation(api.agents.revoke);
  const { datasets } = useDataset();
  const [copied, setCopied] = useState(false);
  const endpoint = `${process.env.NEXT_PUBLIC_SITE_URL}/mcp`;
  return <Page title="Agent connections" description="Give an assistant access to selected datasets. You control its permissions and can disconnect it at any time."
    actions={<Editor title="Register a client"><Form label="Register client" onSave={async d => {
      await register({ name: textValue(d, "name"), redirectUris: textValue(d, "redirects").split(/\r?\n/).map(s => s.trim()).filter(Boolean) });
    }}><TextField name="name" label="Client name" required /><label className="block space-y-2 text-sm">Redirect URLs<textarea name="redirects" required rows={3} placeholder="http://127.0.0.1:8765/callback" className="w-full rounded border bg-background p-3 font-mono text-sm" /></label><p className="text-xs text-muted-foreground">One exact callback URL per line. HTTPS is required except for local loopback addresses. Registration identifies your client; data access requires a separate consent step.</p></Form></Editor>}>
    <Panel title="Connect your assistant" description="Register your client, then use its client ID and this server address to start the browser authorization flow.">
      <div className="flex flex-wrap items-center justify-between gap-3 py-2"><code className="break-all text-sm">{endpoint}</code><Action onClick={async () => { await navigator.clipboard.writeText(endpoint); setCopied(true); }}>{copied ? "Copied" : "Copy address"}</Action></div>
      <p className="mt-3 text-xs text-muted-foreground">Connections expire after 30 days. Changes appear in your open LifeOR2 windows automatically.</p>
    </Panel>
    <Panel title="Connected agents" description="Each authorization is independent. Disconnecting an agent immediately blocks its access and refresh tokens.">
      {!result ? <p role="status">Loading connections…</p> : !result.connections.length ? <p className="py-4 text-sm text-muted-foreground">No agents connected yet. Register a client above to get started.</p> : <ul className="divide-y">{result.connections.slice().reverse().map(c => {
        const inactive = c.revoked_at !== undefined || c.expires_at <= Date.now();
        return <li key={c._id} className="flex flex-wrap items-start justify-between gap-4 py-5"><div><p className="font-medium">{c.name} <span className="ml-2 text-xs text-muted-foreground">{c.revoked_at ? "Disconnected" : inactive ? "Expired" : "Connected"}</span></p>
          <p className="mt-1 text-sm text-muted-foreground">{c.dataset_ids.map(id => datasets.find(d => d._id === id)?.name ?? "Unavailable dataset").join(", ")}</p>
          <p className="mt-2 text-xs">{c.scopes.map(s => AGENT_SCOPE_LABELS[s] ?? s).join(" · ")}</p><p className="mt-2 text-xs text-muted-foreground">Expires {new Date(c.expires_at).toLocaleDateString()}{c.last_used_at ? ` · Last change ${new Date(c.last_used_at).toLocaleString()}` : ""}</p></div>
          {!inactive && <Action confirm={`Disconnect ${c.name}? It will need your permission to reconnect.`} onClick={() => revoke({ id: c._id })}>Disconnect</Action>}</li>;
      })}</ul>}
    </Panel>
    <Panel title="Registered clients" description="Client IDs and callback URLs are public metadata. They are not credentials and do not grant data access.">
      {result?.clients.length ? <ul className="divide-y">{result.clients.map(c => <li className="py-4" key={c._id}><p className="font-medium">{c.name}</p><code className="mt-2 block break-all text-xs">{c.clientId}</code><p className="mt-2 break-all text-xs text-muted-foreground">{c.redirect_uris.join(" · ")}</p></li>)}</ul> : <p className="py-4 text-sm text-muted-foreground">No registered clients.</p>}
    </Panel>
    <Panel title="Recent agent changes" description="The latest 50 successful writes, including the connection and dataset responsible.">
      {result?.activity.length ? <ul className="divide-y">{result.activity.map(a => <li key={a._id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><span className="font-mono text-xs">{a.operation}</span><p className="mt-1 text-xs text-muted-foreground">{result.connections.find(c => c._id === a.connection_id)?.name ?? "Agent"} · {datasets.find(d => d._id === a.dataset_id)?.name ?? "Workspace"}</p></div><time className="text-xs text-muted-foreground" dateTime={new Date(a.created_at).toISOString()}>{new Date(a.created_at).toLocaleString()}</time></li>)}</ul> : <p className="py-4 text-sm text-muted-foreground">No agent changes recorded.</p>}
    </Panel>
  </Page>;
}
