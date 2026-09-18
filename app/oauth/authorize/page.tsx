"use client";
import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/lib/auth-client";
import { AGENT_SCOPES } from "@/lib/agent-contract";
import { Button } from "@/components/ui/button";
import "@/components/records.css";

const labels: Record<string, [string, string]> = {
  "data:read": ["Read records", "View records, reports, history and Markdown in selected datasets."],
  "data:write": ["Edit records", "Create and update records, edit notes, and archive or restore items."],
  "finance:write": ["Change financial records", "Create and post journals, record settlements, and manage accounts."],
  "data:delete": ["Permanently delete", "Delete archived records after dependency checks. This cannot be undone."],
  "datasets:manage": ["Manage datasets", "Create datasets, prepare samples, and change the active dataset. Newly created datasets are added to this connection."],
};
export default function AuthorizePage() { return <Suspense fallback={<p className="p-8">Loading authorization…</p>}><Authorization /></Suspense>; }
function Authorization() {
  const params = useSearchParams();
  const { data: session, isPending } = useSession();
  const { isAuthenticated } = useConvexAuth();
  const client = useQuery(api.agents.clientMetadata, { clientId: params.get("client_id") ?? "" });
  const datasets = useQuery(api.datasets.list, session && isAuthenticated ? {} : "skip");
  const requested = (params.get("scope") ?? "data:read").split(" ").filter(Boolean);
  const [selected, setSelected] = useState<string[]>([]), [scopes, setScopes] = useState<string[]>(["data:read"]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const initialize = useMutation(api.datasets.initialize);
  useEffect(() => { if (datasets && !datasets.activeId) void initialize({}).catch(() => setError("Open LifeOR2 to create your first dataset, then try connecting again.")); }, [datasets, initialize]);
  const valid = client && client.redirect_uris.includes(params.get("redirect_uri") ?? "") && params.get("response_type") === "code" && params.get("code_challenge_method") === "S256" && /^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") ?? "") && params.get("resource") === `${process.env.NEXT_PUBLIC_SITE_URL}/mcp` && requested.includes("data:read") && requested.every(s => AGENT_SCOPES.includes(s as never));
  async function decide(approve: boolean) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/oauth/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ authorization: params.toString(), approve, scopes, datasetIds: selected }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Authorization could not be completed.");
      window.location.assign(result.redirect);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Authorization failed."); setBusy(false); }
  }
  return <main className="min-h-screen bg-[#edf0e7] px-5 py-12 text-[#203d35]"><div className="mx-auto max-w-xl rounded-xl border border-[#203d35]/15 bg-white p-6 shadow-sm sm:p-10">
    <p className="text-xs font-semibold uppercase tracking-[.18em]">LifeOR2 · Agent access</p>
    {client === undefined || isPending ? <p className="mt-6" role="status">Checking connection…</p> : !valid ? <><h1 className="mt-5 text-2xl font-semibold">This connection request is invalid</h1><p className="mt-3 text-sm">Check the registered client, callback URL, requested permissions and PKCE settings.</p></> : !session ? <><h1 className="mt-5 text-2xl font-semibold">Sign in to connect {client.client_name}</h1><p className="my-5 text-sm">You’ll choose its datasets and permissions after signing in.</p><a className="underline" href={`/login?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`}>Continue to sign in</a></> : <>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight">Connect {client.client_name}</h1><p className="mt-3 text-sm leading-6">Signed in as <strong>{session.user.email}</strong>. Choose what this assistant can access for the next 30 days. You can disconnect it at any time.</p>
      <fieldset disabled={busy} className="mt-8"><legend className="text-sm font-semibold">Datasets</legend><div className="mt-2 divide-y">{datasets?.datasets.map(d => <label key={d._id} className="flex cursor-pointer items-center gap-3 py-3 text-sm"><input type="checkbox" checked={selected.includes(d._id)} onChange={e => setSelected(e.target.checked ? [...selected, d._id] : selected.filter(id => id !== d._id))} />{d.name}<span className="ml-auto text-xs text-muted-foreground">{d.kind}</span></label>)}</div></fieldset>
      <fieldset disabled={busy} className="mt-7"><legend className="text-sm font-semibold">Permissions requested</legend><div className="mt-2 divide-y">{requested.map(s => <label key={s} className="flex cursor-pointer items-start gap-3 py-3"><input type="checkbox" className="mt-1" disabled={s === "data:read"} checked={scopes.includes(s)} onChange={e => setScopes(e.target.checked ? [...scopes, s] : scopes.filter(v => v !== s))} /><span><span className="text-sm font-medium">{labels[s][0]}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{labels[s][1]}</span></span></label>)}</div></fieldset>
      <p className="mt-5 break-all text-xs text-muted-foreground">Client: {client.client_id}</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="mt-7 flex justify-end gap-3"><Button variant="outline" disabled={busy} onClick={() => decide(false)}>Cancel</Button><Button disabled={busy || !selected.length} onClick={() => decide(true)}>{busy ? "Connecting…" : "Allow selected access"}</Button></div>
    </>}
  </div></main>;
}
