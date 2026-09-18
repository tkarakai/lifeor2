import { expect, test } from 'vitest';
import { recurringScenario } from '../lib/life-reports/recurring-scenario';
import { bankProjection } from '../lib/insights/cash-projection';
import type { CashSchedule, CashRoute, InsightData } from '../lib/insights/types';
const rent: CashSchedule = { id: 'rent', version: 'v1', name: 'Maple rental rent', amount: 270000, currency: 'USD', start: '2025-01-01', validFrom: '2025-01-01', frequency: 'monthly', interval: 1, day: 1, creditor: 'owner', debtor: 'tenant', timezone: 'America/Chicago' };
const route: CashRoute = { source: 'rent', kind: 'commitment_schedule', to: 'bank', currency: 'USD', revision: 1 };
const change = { schedule: 'Maple rent', effectiveDate: '2026-10-01', mode: 'change_by' as const, amount: '200.00' };
const data: InsightData = { accounts: [{ id: 'bank', name: 'Checking', type: 'Asset', chart: 'home', currency: 'USD', financialKind: 'checking' }], postings: [{ id:'open', journal:'open', date:'2026-09-01', account:'bank', amount:100000, memo:'', event:'', portions:[], tags:[] }], entities:[], arrangements:[], charts:[], tags:[], links:[], ownership:[], events:[], measurements:[], obligations:[], flows:[], budgets:[], versions:[], schedules:[], coverage:{untypedMeasurements:0,draftJournals:0,unclassifiedPostings:0}, cashRoutes:[route], cashSchedules:[rent] };
const options = { accountIds:['bank'], start:'2026-09-18', cutoff:'2026-09-18', end:'2026-12-31', schedules:true, assumptions:true, overdue:true };
const final = (d: InsightData, end=options.end) => bankProjection(d,{...options,end}).points.at(-1)!.total;
test('recurring increase replaces baseline rent, preserving opening cash and original data', () => {
 const original = structuredClone(data);
 const changed = recurringScenario(data.cashSchedules!,data.cashRoutes!,[change],options.cutoff,options.end);
 expect(final(data)).toBe(910000);
 expect(final({...data,cashSchedules:changed.schedules})).toBe(970000);
 expect(final({...data,cashSchedules:changed.schedules},'2026-10-31') - final(data,'2026-10-31')).toBe(20000);
 expect(changed.evidence[0]).toMatchObject({recordedAmount:'2700.00',proposedAmount:'2900.00',difference:'200.00'});
 expect(data).toEqual(original);
 const full = recurringScenario([rent],[route],[{...change,mode:'set_amount',amount:'2900.00'}],options.cutoff,options.end);
 expect(final({...data,cashSchedules:full.schedules})).toBe(970000);
});
test('already incurred October rent is not rewritten or double counted by a proposed change', () => {
 const d: InsightData = {...data,obligations:[{id:'oct',name:'October rent',date:'2026-10-01',currency:'USD',creditor:'owner',debtor:'tenant',amount:270000,original:270000,settled:0,schedule:'rent',occurrence:'schedule:rent:monthly:2026-10'}]};
 const changed=recurringScenario([rent],[route],[change],options.cutoff,options.end);
 expect(final({...d,cashSchedules:changed.schedules}) - final(d)).toBe(40000);
 expect(d.obligations[0].amount).toBe(270000);
});
test('later recorded renewals retain boundaries and receive relative differences', () => {
 const terms=[{...rent,validTo:'2026-11-01'},{...rent,version:'v2',validFrom:'2026-11-01',amount:280000}];
 const changed=recurringScenario(terms,[route],[change],options.cutoff,options.end);
 expect(changed.schedules.map(s=>[s.validFrom,s.validTo,s.amount])).toEqual([['2025-01-01','2026-10-01',270000],['2026-10-01','2026-11-01',290000],['2026-11-01',undefined,300000]]);
 expect(final({...data,cashSchedules:changed.schedules}) - final({...data,cashSchedules:terms})).toBe(60000);
});
test('refuses unsupported net cash inference, ambiguity, missing routes and negative recurring totals', () => {
 expect(()=>recurringScenario([rent],[{...route,amount:250000}],[change],options.cutoff,options.end)).toThrow('net cash');
 expect(()=>recurringScenario([rent,{...rent,id:'other'}],[route],[change],options.cutoff,options.end)).toThrow('uniquely');
 expect(()=>recurringScenario([rent],[],[change],options.cutoff,options.end)).toThrow('cash route');
 expect(()=>recurringScenario([rent],[route],[{...change,amount:'-3000'}],options.cutoff,options.end)).toThrow('negative');
 expect(()=>recurringScenario([rent],[route],[{...change,effectiveDate:'2026-09-01'}],options.cutoff,options.end)).toThrow('cutoff');
 expect(()=>recurringScenario([{...rent,start:'2027-01-01'}],[route],[change],options.cutoff,options.end)).toThrow('uniquely');
});
