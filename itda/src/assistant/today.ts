// 오늘 화면 — 오늘 할 일·이번 주 미팅·기한 임박 요청·경조사·장기 미연락·최근 변경과 규칙 기반 「다음 할 일」 추천.
// 원본: ClientMemory app/server.py의 api_dashboard. 저장 없이 계산하는 순수 함수(AI를 쓰지 않는다).
import { addDays, diffDays, isValidDate, ymd } from './dates';
import { labelChange, sortStable, upcomingEvents, type ChangeRow, type EventRow } from './queries';
import { CUSTOMER_TYPES, type AssistantData, type CustRequest, type Customer } from './types';

/** 이 일수 이상 연락이 없으면 「장기 미연락」 */
export const NO_CONTACT_DAYS = 60;
export const RECENT_CHANGES_LIMIT = 12;
export const RECOMMENDATION_LIMIT = 10;

export interface TodayMeeting {
  id: string;
  customerId: string;
  date: string;
  time: string;
  title: string;
  type: string;
  name: string;
  company: string;
  position: string;
}
export interface TodayRequest extends CustRequest {
  name: string;
  company: string;
  position: string;
  dDay: number;
}
export interface NoContactRow {
  id: string;
  name: string;
  company: string;
  position: string;
  lastContactDate: string;
  /** 마지막 연락 후 지난 일수(기록이 없으면 null) */
  days: number | null;
}
export interface Recommendation {
  /** 1이 가장 급함 */
  priority: number;
  customerId: string;
  name: string;
  text: string;
  reason: string;
}
export interface TodayData {
  today: string;
  total: number;
  byType: Record<string, number>;
  meetings: TodayMeeting[];
  todayRequests: TodayRequest[];
  soonRequests: TodayRequest[];
  events: EventRow[];
  noContact: NoContactRow[];
  noContactDays: number;
  recentChanges: (ChangeRow & { name: string })[];
  recentCustomers: Customer[];
  recommendations: Recommendation[];
}

export function buildToday(a: AssistantData, now: Date): TodayData {
  const t = ymd(now);
  const weekEnd = addDays(t, 7);
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  const who = (id: string) => byId.get(id)!;

  const byType: Record<string, number> = Object.fromEntries(CUSTOMER_TYPES.map((k) => [k, 0]));
  for (const c of a.customers) {
    const k = c.customerType || '기타';
    byType[k] = (byType[k] ?? 0) + 1;
  }

  const meetings: TodayMeeting[] = sortStable(
    a.interactions.filter((i) => i.type === '미팅' && i.date >= t && i.date <= weekEnd && byId.has(i.customerId)),
    (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.time < y.time ? -1 : x.time > y.time ? 1 : 0),
  ).map((i) => ({ id: i.id, customerId: i.customerId, date: i.date, time: i.time, title: i.title, type: i.type, name: who(i.customerId).name, company: who(i.customerId).company, position: who(i.customerId).position }));

  const openReqs: TodayRequest[] = sortStable(
    a.requests.filter((r) => r.status !== '완료' && r.dueDate && isValidDate(r.dueDate) && r.dueDate <= weekEnd && byId.has(r.customerId)),
    (x, y) => (x.dueDate < y.dueDate ? -1 : x.dueDate > y.dueDate ? 1 : 0),
  ).map((r) => ({ ...r, name: who(r.customerId).name, company: who(r.customerId).company, position: who(r.customerId).position, dDay: diffDays(t, r.dueDate) }));
  const todayRequests = openReqs.filter((r) => r.dDay <= 0 && r.status !== '보류');
  const soonRequests = openReqs.filter((r) => r.dDay > 0);

  const events = upcomingEvents(a, now, 30);

  const noContact: NoContactRow[] = [];
  for (const c of a.customers) {
    const ref = isValidDate(c.lastContactDate) ? c.lastContactDate : '';
    const gap = ref ? diffDays(ref, t) : null;
    if (gap === null || gap >= NO_CONTACT_DAYS) noContact.push({ id: c.id, name: c.name, company: c.company, position: c.position, lastContactDate: c.lastContactDate, days: gap });
  }
  const noContactSorted = sortStable(noContact, (x, y) => -(x.days ?? 99999) + (y.days ?? 99999));

  const recentChanges = sortStable(
    a.changes.filter((h) => h.source !== 'demo' && byId.has(h.customerId)),
    (x, y) => (x.changedAt < y.changedAt ? 1 : x.changedAt > y.changedAt ? -1 : 0),
    true,
  )
    .slice(0, RECENT_CHANGES_LIMIT)
    .map((h) => ({ ...labelChange(h), name: who(h.customerId).name }));
  const recentCustomers = sortStable(a.customers, (x, y) => (x.createdAt < y.createdAt ? 1 : x.createdAt > y.createdAt ? -1 : 0), true).slice(0, 5);

  // 규칙 기반 다음 할 일(우선순위 1~4, 같은 우선순위는 아래 순서)
  const recs: Recommendation[] = [];
  for (const r of todayRequests) {
    if (r.dDay < 0) recs.push({ priority: 1, customerId: r.customerId, name: r.name, text: `기한이 ${-r.dDay}일 지난 요청사항 처리: ${r.content}`, reason: `처리기한 ${r.dueDate} 경과, 상태 '${r.status}'` });
    else recs.push({ priority: 1, customerId: r.customerId, name: r.name, text: `오늘 기한인 요청사항 처리: ${r.content}`, reason: `처리기한 ${r.dueDate}` });
  }
  for (const m of meetings) {
    const dd = diffDays(t, m.date);
    if (dd <= 2) recs.push({ priority: 2, customerId: m.customerId, name: m.name, text: `${dd === 0 ? '오늘' : `${dd}일 후`} 미팅 준비 — 고객 프로필·미처리 요청 확인`, reason: `미팅 예정: ${m.date} ${m.title}` });
  }
  for (const c of a.customers) {
    if (c.nextContactDate && c.nextContactDate < t) {
      recs.push({ priority: 2, customerId: c.id, name: c.name, text: '예정했던 연락일이 지났습니다. 연락 여부 확인 또는 일정 재설정', reason: `다음 연락 예정일 ${c.nextContactDate}` });
    }
  }
  for (const e of events) {
    if (e.dDay <= 7) recs.push({ priority: 3, customerId: e.customerId, name: e.name, text: `${e.label} ${e.dDay === 0 ? '오늘' : `D-${e.dDay}`} — 축하·안부 연락 검토`, reason: `${e.kind} ${e.date}` });
  }
  for (const c of noContactSorted.slice(0, 5)) {
    recs.push({ priority: 4, customerId: c.id, name: c.name, text: '장기간 연락이 없는 고객 — 안부 연락 검토', reason: c.days !== null ? `마지막 연락 ${c.days}일 전 (${c.lastContactDate})` : '연락 기록 없음' });
  }
  const recommendations = sortStable(recs, (x, y) => x.priority - y.priority).slice(0, RECOMMENDATION_LIMIT);

  return { today: t, total: a.customers.length, byType, meetings, todayRequests, soonRequests, events, noContact: noContactSorted, noContactDays: NO_CONTACT_DAYS, recentChanges, recentCustomers, recommendations };
}
