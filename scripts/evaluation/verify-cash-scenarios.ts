/** Production scenario computation against the isolated, independently reconciled fixture. */
import { ConvexHttpClient } from 'convex/browser';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { cashReport } from '../../lib/mcp/cash-report';
import { presentReport } from '../../lib/mcp/report-presentation';
const root = new URL('../../.convex/query-evaluation/', import.meta.url);
const c = JSON.parse(await readFile(new URL('credentials.json', root), 'utf8'));
process.env.LIFEOR_REPORT_DIRECTORY = new URL('reports',root).pathname;
const client = new ConvexHttpClient('http://127.0.0.1:3340');
const scope = { userId:c.userId,connectionId:'isolated-scenario-oracle',datasetId:c.datasetId };
const results=[];
for (const [mode,amount,through,change] of [['change_by','200.00','2026-10-31','200.00'],['set_amount','2900.00','2026-12-31','600.00']] as const) {
 const r=await cashReport(client,c.token,scope,{scope:'household',asOf:'2026-09-18',through,recurringChanges:[{schedule:'Maple rent',effectiveDate:'2026-10-01',mode,amount}]});
 assert.equal(r.reports.length,1);
 assert.equal(r.reports[0].hypotheticalClosingChange,change);
 if(through==='2026-10-31') {assert.equal(r.reports[0].baselineClosing,'92323.94');assert.equal(r.reports[0].projectedClosing,'92523.94');}
 const text=presentReport(r);assert(text.includes('2700.00 USD'));assert(text.includes('2900.00 USD'));
 results.push({mode,through,baseline:r.reports[0].baselineClosing,scenario:r.reports[0].projectedClosing,change});
}
const result={passed:true,at:new Date().toISOString(),results};
await writeFile(new URL('cash-scenario-postconditions.json',root),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
