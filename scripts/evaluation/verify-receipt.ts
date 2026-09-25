/** Known old receipt in the varied 308,000-journal fixture, no date supplied. */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../../.convex/query-evaluation/', import.meta.url);
const c = JSON.parse(await readFile(new URL('diverse-credentials.json', root), 'utf8'));
const client = new Client({name:'Historical receipt postconditions',version:'1'},{versionNegotiation:{mode:{pin:'2026-07-28'}}});
await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3300/mcp'),{authProvider:{token:async()=>c.token}}));
try {
 const start=Date.now();
 const r=await client.callTool({name:'agentQueries.searchJournals',arguments:{datasetId:c.datasetId,text:'Diverse synthetic Utilities and internet 180003'}});
 assert(!r.isError,'Memo lookup failed');
 const result=r.structuredContent as any;
 assert.equal(result.complete,true);assert.equal(result.nextCursor,null);assert.equal(result.records.length,1);
 const receipt=result.records[0];
 assert.equal(receipt.date,'2012-02-20');
 assert.equal(receipt.memo,'Diverse synthetic Utilities and internet 180003');
 assert.equal(receipt.postings.length,2);
 assert(receipt.postings.some((p:any)=>p.type==='Expense' && p.amount==='43.82'));
 assert(receipt.postings.some((p:any)=>p.account.includes('Harbor Mastercard') && p.account.includes('8844') && p.amount==='-43.82'));
 const evidence={passed:true,at:new Date().toISOString(),elapsedMs:Date.now()-start,bytes:JSON.stringify(result).length,result};
 await writeFile(new URL('receipt-postconditions.json',root),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
} finally {await client.close();}
