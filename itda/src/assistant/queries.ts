// AI 비서 읽기 전용 조회 — 고객 목록·상세, 다가오는 경조사, 활동·요청·기념일 목록. 저장하지 않고 그때그때 계산한다.
// 원본: ClientMemory app/server.py의 api_customer_list·api_customer_detail·upcoming_events·missing_fields·api_*_list.
import { diffDays, isValidDate, nextOccurrence, addDays, ymd } from './dates';
import {
  FIELD_LABELS,
  SOURCE_LABELS,
  type Anniversary,
  type AssistantData,
  type ChangeEntry,
  type CustRequest,
  type Customer,
  type CustomerFieldKey,
  type Interaction,
} from './types';

/** 입력 순서를 보존하는 정렬(비교가 같으면 desc일 때 나중에 만든 것이 앞) */
export function sortStable<T>(arr: readonly T[], cmp: (a: T, b: T) => number, desc = false): T[] {
  return arr
    .map((x, i) => ({ x, i }))
    .sort((p, q) => cmp(p.x, q.x) || (desc ? q.i - p.i : p.i - q.i))
    .map((p) => p.x);
}
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const asciiLower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

// ───────────── 비어 있는 항목 ─────────────

const SALES_FIELDS: [CustomerFieldKey | CustomerFieldKey[], string][] = [
  ['mobile', '휴대전화'],
  ['email', '이메일'],
  ['department', '부서'],
  ['position', '직책'],
  ['customerType', '고객 유형'],
  ['personality', '성격·대화 스타일'],
  [['foodLikes', 'foodDislikes'], '음식 선호·기피'],
  ['hobbies', '취미·관심사'],
  ['recentInterests', '최근 관심 주제'],
  ['contactPreference', '선호 연락 방식'],
];
/** 영업에 도움이 되는데 비어 있는 항목 이름 */
export function missingFields(c: Customer): string[] {
  const out: string[] = [];
  for (const [keys, label] of SALES_FIELDS) {
    const ks = Array.isArray(keys) ? keys : [keys];
    if (!ks.some((k) => (c[k] || '').trim())) out.push(label);
  }
  return out;
}

// ───────────── 다가오는 경조사 ─────────────

export interface EventRow {
  customerId: string;
  name: string;
  company: string;
  position: string;
  kind: string;
  label: string;
  date: string;
  dDay: number;
  anniversaryId: string | null;
  source: 'customer' | 'anniversary';
}

/** 앞으로 withinDays일 안의 생일(고객 생년월일)과 등록한 기념일. 가까운 날부터 */
export function upcomingEvents(a: AssistantData, now: Date, withinDays = 30, customerId?: string): EventRow[] {
  const t = ymd(now);
  const events: EventRow[] = [];
  const custs = customerId ? a.customers.filter((c) => c.id === customerId) : a.customers;
  for (const c of custs) {
    if (!c.birthDate) continue;
    const nxt = nextOccurrence(c.birthDate, t);
    if (nxt && diffDays(t, nxt) <= withinDays) {
      events.push({ customerId: c.id, name: c.name, company: c.company, position: c.position, kind: '생일', label: '생일', date: nxt, dDay: diffDays(t, nxt), anniversaryId: null, source: 'customer' });
    }
  }
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  for (const an of a.anniversaries) {
    if (customerId && an.customerId !== customerId) continue;
    const c = byId.get(an.customerId);
    if (!c) continue;
    let nxt: string | null;
    if (an.repeatYearly) nxt = nextOccurrence(an.date, t);
    else {
      nxt = isValidDate(an.date) ? an.date : null;
      if (nxt && nxt < t) nxt = null;
    }
    if (nxt && diffDays(t, nxt) <= withinDays) {
      events.push({ customerId: c.id, name: c.name, company: c.company, position: c.position, kind: an.kind, label: an.label || an.kind, date: nxt, dDay: diffDays(t, nxt), anniversaryId: an.id, source: 'anniversary' });
    }
  }
  return sortStable(events, (x, y) => x.dDay - y.dDay);
}

// ───────────── 고객 목록 ─────────────

export interface CustomerRow {
  id: string;
  name: string;
  company: string;
  department: string;
  position: string;
  customerType: string;
  mobile: string;
  email: string;
  lastContactDate: string;
  isDemo: boolean;
  recentInterests: string;
  hobbies: string;
  openRequests: number;
  missing: number;
  updatedAt: string;
  ownerId: string;
}
export type CustomerSort = 'name' | 'recent' | 'contact' | 'company';
const LIST_SEARCH_FIELDS: CustomerFieldKey[] = ['name', 'company', 'department', 'position', 'duties', 'customerType', 'hobbies', 'recentInterests', 'foodLikes', 'personality', 'email', 'mobile', 'salesNotes'];

/** 고객 목록: 검색어(공백으로 나눈 낱말을 모두 포함), 유형, 정렬(name·recent·contact·company) */
export function listCustomers(a: AssistantData, o: { q?: string; type?: string; sort?: CustomerSort } = {}): CustomerRow[] {
  const terms = (o.q ?? '').trim().split(/\s+/).filter(Boolean).map(asciiLower);
  let rows = a.customers.filter((c) => {
    if (o.type && c.customerType !== o.type) return false;
    return terms.every((t) => LIST_SEARCH_FIELDS.some((f) => asciiLower(c[f] || '').includes(t)));
  });
  const cmp: Record<CustomerSort, (x: Customer, y: Customer) => number> = {
    name: (x, y) => cmpStr(asciiLower(x.name), asciiLower(y.name)),
    recent: (x, y) => cmpStr(y.updatedAt, x.updatedAt),
    contact: (x, y) => Number(!!x.lastContactDate) - Number(!!y.lastContactDate) || cmpStr(x.lastContactDate, y.lastContactDate),
    company: (x, y) => cmpStr(x.company, y.company) || cmpStr(x.name, y.name),
  };
  rows = sortStable(rows, cmp[o.sort ?? 'name']);
  const open = new Map<string, number>();
  for (const r of a.requests) if (r.status !== '완료') open.set(r.customerId, (open.get(r.customerId) ?? 0) + 1);
  return rows.map((c) => ({
    id: c.id, name: c.name, company: c.company, department: c.department, position: c.position, customerType: c.customerType,
    mobile: c.mobile, email: c.email, lastContactDate: c.lastContactDate, isDemo: c.isDemo, recentInterests: c.recentInterests,
    hobbies: c.hobbies, openRequests: open.get(c.id) ?? 0, missing: missingFields(c).length, updatedAt: c.updatedAt, ownerId: c.ownerId,
  }));
}

// ───────────── 고객 상세 ─────────────

export interface ChangeRow extends ChangeEntry {
  fieldLabel: string;
  sourceLabel: string;
}
export const labelChange = (h: ChangeEntry): ChangeRow => ({
  ...h,
  fieldLabel: (FIELD_LABELS as Record<string, string>)[h.field] ?? h.field,
  sourceLabel: (SOURCE_LABELS as Record<string, string>)[h.source] ?? h.source,
});

export interface RequestRow extends CustRequest {
  dDay: number | null;
}
export interface AnniversaryRow extends Anniversary {
  nextDate: string;
  dDay: number | null;
}
export interface CustomerDetail {
  customer: Customer;
  /** 항목별 마지막 변경(언제·어떤 출처) */
  fieldMeta: Record<string, { changedAt: string; source: string; sourceLabel: string }>;
  interactions: Interaction[];
  requests: RequestRow[];
  anniversaries: AnniversaryRow[];
  birthday: { date: string; dDay: number } | null;
  history: ChangeRow[];
  missing: string[];
}

const dDayOf = (due: string, t: string) => (due && isValidDate(due) ? diffDays(t, due) : null);

export function customerDetail(a: AssistantData, id: string, now: Date): CustomerDetail | null {
  const c = a.customers.find((x) => x.id === id);
  if (!c) return null;
  const t = ymd(now);
  const mine = a.changes.filter((h) => h.customerId === id);
  const fieldMeta: CustomerDetail['fieldMeta'] = {};
  for (const h of sortStable(mine, (x, y) => cmpStr(x.changedAt, y.changedAt))) {
    fieldMeta[h.field] = { changedAt: h.changedAt, source: h.source, sourceLabel: (SOURCE_LABELS as Record<string, string>)[h.source] ?? h.source };
  }
  const interactions = sortStable(a.interactions.filter((i) => i.customerId === id), (x, y) => cmpStr(y.date, x.date) || cmpStr(y.time, x.time), true);
  const requests = sortStable(a.requests.filter((r) => r.customerId === id), (x, y) => Number(x.status === '완료') - Number(y.status === '완료') || cmpStr(x.dueDate || '9999', y.dueDate || '9999')).map((r) => ({ ...r, dDay: dDayOf(r.dueDate, t) }));
  const anniversaries = sortStable(a.anniversaries.filter((x) => x.customerId === id), (x, y) => cmpStr(x.date, y.date)).map((x) => {
    const n = x.repeatYearly ? nextOccurrence(x.date, t) : isValidDate(x.date) ? x.date : null;
    return { ...x, nextDate: n ?? '', dDay: n ? diffDays(t, n) : null };
  });
  const bn = c.birthDate ? nextOccurrence(c.birthDate, t) : null;
  return {
    customer: c,
    fieldMeta,
    interactions,
    requests,
    anniversaries,
    birthday: bn ? { date: bn, dDay: diffDays(t, bn) } : null,
    history: sortStable(mine, (x, y) => cmpStr(y.changedAt, x.changedAt), true).map(labelChange),
    missing: missingFields(c),
  };
}

// ───────────── 활동·요청·기념일 목록 ─────────────

export interface InteractionRow extends Interaction {
  name: string;
  company: string;
  position: string;
}
/** 활동 목록(최대 500건, 최근 순). 검색어는 제목·요약·상세·고객 이름·소속에서 찾는다 */
export function listInteractions(a: AssistantData, q = ''): InteractionRow[] {
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  const needle = asciiLower(q.trim());
  const rows: InteractionRow[] = [];
  for (const i of a.interactions) {
    const c = byId.get(i.customerId);
    if (!c) continue;
    if (needle && ![i.title, i.summary, i.details, c.name, c.company].some((f) => asciiLower(f || '').includes(needle))) continue;
    rows.push({ ...i, name: c.name, company: c.company, position: c.position });
  }
  return sortStable(rows, (x, y) => cmpStr(y.date, x.date) || cmpStr(y.time, x.time), true).slice(0, 500);
}

export interface RequestListRow extends RequestRow {
  name: string;
  company: string;
  position: string;
}
/** 요청 목록. status: 'open'(완료 아님) | 요청 상태 이름 | ''(전체) */
export function listRequests(a: AssistantData, status: string, now: Date): RequestListRow[] {
  const t = ymd(now);
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  const rows: RequestListRow[] = [];
  for (const r of a.requests) {
    const c = byId.get(r.customerId);
    if (!c) continue;
    if (status === 'open' ? r.status === '완료' : status && r.status !== status) continue;
    rows.push({ ...r, dDay: dDayOf(r.dueDate, t), name: c.name, company: c.company, position: c.position });
  }
  return sortStable(rows, (x, y) => Number(x.status === '완료') - Number(y.status === '완료') || cmpStr(x.dueDate || '9999', y.dueDate || '9999'));
}

/** 경조사 화면: 앞으로 1년의 일정과 등록한 기념일 전체(날짜의 월-일 순) */
export function listAnniversaries(a: AssistantData, now: Date) {
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  const list = a.anniversaries
    .filter((x) => byId.has(x.customerId))
    .map((x) => ({ ...x, name: byId.get(x.customerId)!.name, company: byId.get(x.customerId)!.company }));
  return { events: upcomingEvents(a, now, 366), anniversaries: sortStable(list, (x, y) => cmpStr(x.date.slice(5), y.date.slice(5))) };
}

/** 오늘로부터 n일 뒤 날짜 */
export const daysFrom = (now: Date, n: number) => addDays(ymd(now), n);
