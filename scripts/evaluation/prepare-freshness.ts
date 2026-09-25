/** Prepare an isolated calendar correction and a source with widely separated facts. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../.convex/query-evaluation/', import.meta.url);
const c = JSON.parse(await readFile(new URL('write-credentials.json', root), 'utf8'));
const client = new Client({name:'Fresh evidence fixture',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3300/mcp'),{authProvider:{token:async()=>c.token}}));
async function call(name:string,args:Record<string,unknown>) {
 const r=await client.callTool({name,arguments:{datasetId:c.datasetId,...args}});
 assert(!r.isError, name+' failed'); return r.structuredContent as any;
}
try {
 const person=await call('life.search',{query:'Riley Ellis',kind:'entity'});
 assert.equal(person.identityStatus,'unique');
 const events=await call('life.events',{entityId:person.items[0].id,query:'Riley clock-change visit'});
 assert.equal(events.queryComplete,true);assert.equal(events.items.length,1);
 assert.equal(events.items[0].occurredAt,'2026-11-01T07:30:00.000Z');
 let notePerson=await call('life.search',{query:'Robin Hayes',kind:'entity'});
 if(!notePerson.items.length){await call('entities.create',{requestKey:'long-source-robin-v1',kind:'Person',display_name:'Robin Hayes'});notePerson=await call('life.search',{query:'Robin Hayes',kind:'entity'});}
 assert.equal(notePerson.identityStatus,'unique');
 const target={kind:'entity',id:notePerson.items[0].id};
 const source='# Oak Annex rules for Robin Hayes\nParking: two visitor spaces.\n'+'Archived routine inspection: building condition unchanged.\n'.repeat(1100)+'\nPets: one small dog weighing no more than 20 kg is permitted.\n';
 const metadata=await call('details.read',{target,detail:'metadata'});
 if(metadata.availability==='missing')await call('details.save',{target,source,expectedCommit:null});
 const current=await call('details.read',{target,detail:'metadata'});
 const full=await call('details.revision',{target,commit:current.commit});
 assert.equal(full.source,source,'Do not overwrite an altered fixture note');
 const result={passed:true,at:new Date().toISOString(),event:events.items[0],personId:person.items[0].id,note:{target,commit:current.commit,length:source.length}};
 await writeFile(new URL('freshness-fixture.json',root),JSON.stringify(result,null,2));
 console.log(JSON.stringify({passed:true,sourceCharacters:source.length,eventId:events.items[0].id}));
} finally {await client.close();}
