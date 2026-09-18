/** Prepare one isolated appointment for deterministic clock-clarification acceptance. */
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
 const original=await call('records.recordEvent',{requestKey:'typed-clock-fixture-v1',title:'Riley clock-change visit',kind:'appointment',date:'2027-01-12',time:'10:00',timezone:'America/Chicago',subjects:[{kind:'entity',id:person.items[0].id}]});
 assert.equal(original.occurredAt,'2027-01-12T16:00:00.000Z');
 const result={passed:true,at:new Date().toISOString(),event:original,personId:person.items[0].id};
 await writeFile(new URL('typed-clock-fixture.json',root),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:true,eventId:original.id}));
} finally {await client.close();}
