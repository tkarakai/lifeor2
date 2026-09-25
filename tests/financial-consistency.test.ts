import { expect, test } from 'vitest';
import { collectFinance, type FinancePage } from '../lib/life-reports/finance';
const page: FinancePage = {versioned:true, revision:7, rows:[], nextCursor:null,examinedJournals:0,examinedCells:1,warnings:[],queryComplete:true,datasetCompleteness:'unknown',from:'2010-01-01',through:'2025-12-31'};
test('revision-guarded reads accept only pages from the same monotonic dataset version', async()=>{
 let calls=0;
 const result=await collectFinance(async()=>({...page,nextCursor:++calls<3?String(calls):null,queryComplete:calls===3}),100,true);
 expect(result.pages).toBe(3);expect(result.revision).toBe(7);expect(result.queryComplete).toBe(true);
 calls=0;
 await expect(collectFinance(async()=>({...page,revision:7+calls,nextCursor:++calls<3?String(calls):null,queryComplete:calls===3}),100,true)).rejects.toThrow('DATA_CHANGED');
});
test('unversioned legacy scopes cannot silently use the optimistic consistency path', async()=>{
 await expect(collectFinance(async()=>({...page,versioned:false}),100,true)).rejects.toThrow('PINNED_SNAPSHOT_REQUIRED');
 await expect(collectFinance(async()=>({...page,versioned:undefined}),100,true)).rejects.toThrow('PINNED_SNAPSHOT_REQUIRED');
 expect((await collectFinance(async()=>({...page,versioned:false}))).queryComplete).toBe(true);
});
