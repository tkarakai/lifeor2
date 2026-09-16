/** Fictional demonstration, not lending quotes or financial advice. All money is cents. */
export const SAMPLE_AS_OF = "2026-09-16";
export const SAMPLE_VERSION = "family-v1";
export const loans = [
  {
    key: "oak",
    name: "Oak Street rental mortgage",
    asset: "214 Oak Street · rental",
    principal: 24000000,
    price: 30000000,
    aprBps: 325,
    months: 360,
    start: "2021-09-01",
    first: "2021-10-01",
    end: "2051-10-01",
    paidAtOpening: 51,
    escrow: 41000,
  },
  {
    key: "maple",
    name: "Maple Avenue rental mortgage",
    asset: "88 Maple Avenue · rental",
    principal: 28800000,
    price: 36000000,
    aprBps: 350,
    months: 360,
    start: "2021-09-01",
    first: "2021-10-01",
    end: "2051-10-01",
    paidAtOpening: 51,
    escrow: 48500,
  },
  {
    key: "home",
    name: "Cedar Lane home mortgage",
    asset: "17 Cedar Lane · primary residence",
    principal: 48000000,
    price: 60000000,
    aprBps: 625,
    months: 360,
    start: "2025-09-01",
    first: "2025-10-01",
    end: "2055-10-01",
    paidAtOpening: 3,
    escrow: 82000,
  },
  {
    key: "car",
    name: "Highlander auto loan",
    asset: "2022 Toyota Highlander",
    principal: 3600000,
    price: 4200000,
    aprBps: 550,
    months: 60,
    start: "2022-09-01",
    first: "2022-10-01",
    end: "2027-10-01",
    paidAtOpening: 39,
    escrow: 0,
  },
] as const;
export function amortization(
  principal: number,
  aprBps: number,
  months: number,
) {
  const rate = aprBps / 120000;
  const payment = Math.round((principal * rate) / (1 - (1 + rate) ** -months));
  let balance = principal;
  const rows = [];
  for (let n = 1; n <= months; n++) {
    const interest = Number(
      (BigInt(balance) * BigInt(aprBps) + 60000n) / 120000n,
    );
    const principalPaid =
      n === months ? balance : Math.min(balance, payment - interest);
    balance -= principalPaid;
    rows.push({
      number: n,
      payment: principalPaid + interest,
      principal: principalPaid,
      interest,
      balance,
    });
  }
  return rows;
}
export const sampleNotes: Record<string, string> = {
  "Morgan family":
    "Fictional family of four: Alex and Jamie Morgan, with children Emma (12) and Noah (8). USD. Records as of September 16, 2026. Two household checking accounts plus a separate checking account for each LLC. Separate household and LLC charts prevent owner draws from being counted as business income twice.",
  "Alex Morgan":
    "Full-time salaried software engineer at Northstar Analytics Inc.; annual gross salary $156,000, paid twice monthly. Also owns Morgan Software LLC, a pre-revenue software development business. Payroll deductions are simplified illustrative totals.",
  "Jamie Morgan":
    "Self-employed owner of Juniper Design LLC, an interior-design studio. Clients pay through Square. Gross sales, processing fees and net bank deposits are recorded separately. Owner draws transfer funds into household checking without creating new revenue.",
  "Emma Morgan":
    "Fictional child, age 12 as of September 2026. Household expenses include school activities and shared living costs.",
  "Noah Morgan":
    "Fictional child, age 8 as of September 2026. Household expenses include school activities and shared living costs.",
  "Cedar Lane remodel":
    "A time-bounded grouping tag for the primary-residence kitchen and bathroom remodel, June–November 2026. Contract budget $85,000. $25,000 demolition/materials milestone completed and paid June 10; a $30,000 progress invoice recorded September 10, of which $15,000 was paid September 12 and $15,000 remains due September 30. Remaining $30,000 contract milestone is future work, not an incurred payable. Remodeling costs use a capital-improvement asset account, not recurring maintenance expense. The contractor agreement is a real arrangement; the project itself is only this tag.",
  "Morgan Software LLC":
    "Alex's single-member software development LLC. No revenue through September 16, 2026. Maintains a dedicated business checking account, funded by Alex, and pays cloud hosting, software subscriptions and annual registration costs. Owner contributions are equity, not income.",
  "Juniper Design LLC":
    "Jamie's single-member design studio. Regular customer receipts flow through Square clearing to the studio checking account. A simplified illustrative processing fee of 2.9% + $0.30 is used per recorded batch; these are fictional assumptions, not current Square pricing. Monthly owner draws, software, supplies and contractor payments are included.",
  "2018 Honda Civic":
    "Owned outright. Used primarily for Alex's commute. Opening carrying value $12,000; routine oil service and tire replacement are expenses.",
  "2016 Subaru Outback":
    "Owned outright. Opening carrying value $10,000; family use, with routine service and brake work.",
};
for (const loan of loans) {
  const schedule = amortization(loan.principal, loan.aprBps, loan.months);
  const current = schedule[loan.paidAtOpening + 8];
  sampleNotes[loan.name] =
    `Fictional fixed-rate loan. Originated ${loan.start}; first payment ${loan.first}. Original principal $${(loan.principal / 100).toFixed(2)}; fixed APR ${(loan.aprBps / 100).toFixed(2)}%; term ${loan.months} months. Regular principal-and-interest payment $${(schedule[0].payment / 100).toFixed(2)}. ${loan.escrow ? `Monthly escrow deposit $${(loan.escrow / 100).toFixed(2)}, recorded separately from interest/principal. ` : ""}Last scheduled payment ${loan.end.slice(0, 4)}-09-01; schedule end is exclusive. Opening balance on 2025-12-31 reflects ${loan.paidAtOpening} prior payments. Nine actual payments January–September 2026 leave principal $${(current.balance / 100).toFixed(2)}. Amortization rounds monthly interest to cents; the last installment clears the remaining principal. Historic pre-2026 payments are represented by the opening balance, not fabricated duplicate transactions.`;
  sampleNotes[loan.asset] =
    `Fictional identifiable asset. Original acquisition price $${(loan.price / 100).toFixed(2)}. Related financing: ${loan.name}. The asset and financing obligation are modeled separately.`;
}
