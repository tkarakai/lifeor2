/** Verify a next-year event and rejection of an ambiguous fall-back-clock edit. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../.convex/query-evaluation/', import.meta.url);
const c = JSON.parse(await readFile(new URL('write-credentials.json', root), 'utf8'));
const client = new Client({name:'Future appointment postconditions',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3300/mcp'),{authProvider:{token:async()=>c.token}}));
async function call(name:string,args:Record<string,unknown>) {
 const r=await client.callTool({name,arguments:{datasetId:c.datasetId,...args}});
 assert(!r.isError, name+' failed'); return r.structuredContent as any;
}
try {
 const person=await call('life.search',{query:'Riley Ellis',kind:'entity'});
 assert.equal(person.identityStatus,'unique');
 const events=await call('life.events',{entityId:person.items[0].id,query:'Riley dentist visit',from:'2026-09-18',limit:50});
 assert.equal(events.queryComplete,true);assert.equal(events.items.length,1);
 assert.equal(events.items[0].occurredAt,'2027-01-12T16:00:00.000Z');
 const source=await call('life.read',{kind:'event',id:events.items[0].id});
 assert(!source.record.corrects_id,'The unresolved ambiguous edit must not have created a correction');
 const result={passed:true,at:new Date().toISOString(),event:events.items[0]};
 await writeFile(new URL('future-appointment-postconditions.json',root),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
} finally {await client.close();}
