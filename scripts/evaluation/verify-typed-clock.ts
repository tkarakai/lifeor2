/** Verify explicit resolution of the second fall-back-clock occurrence. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../.convex/query-evaluation/', import.meta.url);
const c = JSON.parse(await readFile(new URL('write-credentials.json', root), 'utf8'));
const client = new Client({name:'Resolved fold postconditions',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3300/mcp'),{authProvider:{token:async()=>c.token}}));
async function call(name:string,args:Record<string,unknown>) {
 const r=await client.callTool({name,arguments:{datasetId:c.datasetId,...args}});
 assert(!r.isError, name+' failed'); return r.structuredContent as any;
}
try {
 const person=await call('life.search',{query:'Riley Ellis',kind:'entity'});
 assert.equal(person.identityStatus,'unique');
 const events=await call('life.events',{entityId:person.items[0].id,query:'Riley clock-change visit',from:'2026-09-18',limit:50});
 assert.equal(events.queryComplete,true);assert.equal(events.items.length,1);
 assert.equal(events.items[0].occurredAt,'2026-11-01T07:30:00.000Z');
 const source=await call('life.read',{kind:'event',id:events.items[0].id});
 const prior=JSON.parse(await readFile(new URL('typed-clock-fixture.json',root),'utf8'));
 assert.equal(person.items[0].id,prior.personId);
 assert.equal(events.items[0].clockOccurrence,'Second occurrence (UTC−06:00)');
 assert.equal(events.items[0].utcOffset,'UTC-06:00');
 assert.equal(source.record.corrects_id,prior.event.id,'Must correct the original appointment');
 const old=await call('life.read',{kind:'event',id:prior.event.id});
 assert.equal(new Date(old.record.occurred_at).toISOString(),'2027-01-12T16:00:00.000Z');
 const result={passed:true,at:new Date().toISOString(),event:events.items[0]};
 await writeFile(new URL('typed-clock-postconditions.json',root),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result));
} finally {await client.close();}
