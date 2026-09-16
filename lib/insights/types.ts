export type Named = { id: string; name: string };
export type Entity = Named & { kind: string };
export type Arrangement = Named & {
  kind: string;
  start: string;
  end?: string;
  lifecycle: string;
};
export type Account = Named & {
  chart: string;
  type: string;
  currency: string;
  financialKind?: string;
  arrangement?: string;
};
export type Portion = {
  id?: string;
  amount: number;
  subject?: string;
  arrangement?: string;
  counterparty?: string;
  tags: string[];
  beneficiaries: { entity?: string; amount: number }[];
};
export type Posting = {
  id: string;
  journal: string;
  date: string;
  account: string;
  amount: number;
  memo: string;
  event: string;
  portions: Portion[];
  tags: string[];
};
export type LifeEvent = Named & {
  date: string;
  kind: string;
  targets: string[];
  tags: string[];
};
export type Measurement = Named & {
  date: string;
  subject: string;
  value: number;
  unit: string;
  assertion: string;
};
export type Obligation = Named & {
  date: string;
  currency: string;
  creditor: string;
  debtor: string;
  arrangement?: string;
  amount: number;
  original: number;
  settled: number;
  schedule?: string;
  occurrence?: string;
};
export type Flow = Named & {
  date: string;
  amount: number;
  currency: string;
  account?: string;
  obligation?: string;
  source: string;
  occurrence?: string;
  tags: string[];
  entities: string[];
};
export type Budget = Named & {
  version: string;
  start: string;
  end: string;
  measure: "income" | "expense";
  chart: string;
  account?: string;
  subject?: string;
  tags?: string[];
  scopeTargets?: string[];
  amount: number;
  currency: string;
  status: string;
};
export type CashRoute = {
  source: string;
  kind: "monetary_obligation" | "commitment_schedule";
  from?: string;
  to?: string;
  amount?: number;
  days?: number[];
  revision: number;
  currency: string;
};
export type CashSchedule = Named & {
  version: string;
  currency: string;
  amount?: number;
  start: string;
  end?: string;
  validFrom: string;
  validTo?: string;
  frequency: string;
  interval: number;
  day?: number;
  creditor: string;
  debtor: string;
  timezone: string;
};
export type InsightData = {
  cashRoutes?: CashRoute[];
  blockedCashOccurrences?: string[];
  cashSchedules?: CashSchedule[];
  entities: Entity[];
  arrangements: Arrangement[];
  accounts: Account[];
  charts: Named[];
  tags: Named[];
  links: {
    entity: string;
    arrangement: string;
    role: string;
    start: string;
    end?: string;
  }[];
  ownership: {
    owner: string;
    asset: string;
    share: number;
    start: string;
    end?: string;
  }[];
  postings: Posting[];
  events: LifeEvent[];
  measurements: Measurement[];
  obligations: Obligation[];
  flows: Flow[];
  budgets: Budget[];
  versions: (Named & { status: string })[];
  schedules: (Named & {
    arrangement: string;
    creditor: string;
    debtor: string;
    amount?: number;
    currency: string;
    frequency: string;
    interval: number;
    start: string;
    end?: string;
  })[];
  coverage: {
    untypedMeasurements: number;
    draftJournals: number;
    unclassifiedPostings: number;
    latestPosting?: string;
  };
};
export type Filters = {
  start: string;
  end: string;
  currency: string;
  chart: string;
  entity: string;
  tag: string;
};
export type Bucket = {
  key: string;
  label: string;
  income: number;
  expense: number;
  net: number;
  assets: number;
  liabilities: number;
  worth: number;
};
export type ChartDatum = {
  id: string;
  label: string;
  value: number;
  color?: string;
  detail?: string;
};
