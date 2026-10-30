// 미팅 브리핑 — 저장된 고객정보만으로 30초 안에 읽을 수 있게 규칙으로 정리한다. 외부 AI로 보내지 않고, 저장된 사실만 옮기며 새 내용을 지어내지 않는다.
// 원본: ClientMemory app/briefing.py.
import { addDays, diffDays, hhmm, isValidDate, len, mdLabel, nextOccurrence, pyRound, ymd } from './dates';
import { sortStable } from './queries';
import type { AssistantData, Interaction } from './types';

export type Tone = '' | 'muted' | 'good' | 'bad' | 'warn';
export interface BriefingLine {
  label: string;
  value: string;
  tone: Tone;
}
export interface BriefingRequest {
  content: string;
  status: string;
  /** 「기한 경과」「오늘 기한」「D-n」 또는 '' */
  due: string;
  overdue: boolean;
}
export interface Briefing {
  customer: { id: string; name: string; position: string; company: string; department: string; customerType: string; updatedAt: string; mobile: string };
  meeting: Interaction | null;
  lines: BriefingLine[];
  /** 이번 미팅 확인사항(최대 5개) */
  checks: string[];
  openRequests: BriefingRequest[];
  /** 읽는 시간 추정(초, 한글 분당 700자 기준) */
  readSeconds: number;
  note: string;
}

/** 한 줄로 줄이고 n자를 넘으면 …로 자른다 */
export function cut(s: string | undefined, n: number): string {
  const t = (s ?? '').replace(/\n/g, ' ').trim();
  const cs = Array.from(t);
  return cs.length <= n ? t : cs.slice(0, n - 1).join('') + '…';
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 고객 한 명의 브리핑. interactionId를 주면 그 미팅 기준, 없으면 가장 가까운 예정 미팅 */
export function buildBriefing(a: AssistantData, customerId: string, now: Date, interactionId?: string | null): Briefing | null {
  const c = a.customers.find((x) => x.id === customerId);
  if (!c) return null;
  const today = ymd(now);

  let meeting: Interaction | null = null;
  if (interactionId) meeting = a.interactions.find((i) => i.id === interactionId && i.customerId === customerId) ?? null;
  if (!meeting) {
    meeting = sortStable(a.interactions.filter((i) => i.customerId === customerId && i.type === '미팅' && i.date >= today), (x, y) => cmpStr(x.date, y.date) || cmpStr(x.time, y.time))[0] ?? null;
  }

  const lines: BriefingLine[] = [];
  const add = (label: string, value: string, tone: Tone = '') => {
    if (value) lines.push({ label, value, tone });
  };
  const ago = (d: string) => {
    const n = diffDays(d, today);
    return n === 0 ? '오늘' : `${n}일 전`;
  };

  if (c.lastMeetingDate) add('최근 만남', `${mdLabel(c.lastMeetingDate)} (${ago(c.lastMeetingDate)})`);
  else if (c.lastContactDate) add('최근 연락', `${mdLabel(c.lastContactDate)} (${ago(c.lastContactDate)}, 대면 미팅 기록 없음)`);
  else add('최근 만남', '기록 없음', 'muted');
  add('주요 관심사', cut([c.hobbies, c.recentInterests].filter(Boolean).join(', '), 60));
  add('선호 음식', cut(c.foodLikes, 40), 'good');
  add('기피 음식', cut(c.foodDislikes, 40), 'bad');
  add('대화 스타일', cut(c.personality, 60));
  add('선호 연락', cut(c.contactPreference, 40));

  const hm = hhmm(now);
  const lastList = sortStable(
    a.interactions.filter((i) => i.customerId === customerId && i.type !== '메모' && (i.date < today || (i.date === today && (i.time === '' || i.time <= hm))) && i.id !== (meeting?.id ?? '')),
    (x, y) => cmpStr(y.date, x.date) || cmpStr(y.time, x.time),
    true,
  );
  const last = lastList[0];
  if (last) add('최근 대화', cut(`${mdLabel(last.date)} ${last.type} · ${last.title}` + (last.summary ? ` — ${last.summary}` : ''), 90));

  const reqs = sortStable(a.requests.filter((r) => r.customerId === customerId && r.status !== '완료'), (x, y) => cmpStr(x.dueDate || '9999', y.dueDate || '9999'));
  const reqLines: BriefingRequest[] = reqs.map((r) => {
    let dd = '';
    if (r.dueDate && isValidDate(r.dueDate)) {
      const n = diffDays(today, r.dueDate);
      dd = n < 0 ? '기한 경과' : n === 0 ? '오늘 기한' : `D-${n}`;
    }
    return { content: r.content, status: r.status, due: dd, overdue: dd === '기한 경과' };
  });
  if (reqLines.length) {
    add('미처리 요청', reqLines.slice(0, 3).map((x) => cut(x.content, 40) + (x.due ? ` (${x.due})` : '')).join(' / ') + (reqLines.length > 3 ? ` 외 ${reqLines.length - 3}건` : ''), 'warn');
  }

  const events: [string, string][] = [];
  if (c.birthDate) {
    const n = nextOccurrence(c.birthDate, today);
    if (n && diffDays(today, n) <= 30) events.push(['생일', n]);
  }
  for (const an of a.anniversaries.filter((x) => x.customerId === customerId)) {
    const n = an.repeatYearly ? nextOccurrence(an.date, today) : an.date >= today && isValidDate(an.date) ? an.date : null;
    if (n && diffDays(today, n) <= 30) events.push([an.label || an.kind, n]);
  }
  const evs = sortStable(events, (x, y) => cmpStr(x[1], y[1]));
  if (evs.length) add('다가오는 경조사', evs.slice(0, 2).map(([lbl, d]) => `${lbl} ${mdLabel(d)}`).join(', '));
  add('참고사항', cut(c.salesNotes, 80));

  // 이번 미팅 확인사항(규칙 기반, 최대 5개)
  const checks: string[] = [];
  if (meeting?.summary) checks.push(`미팅 목적: ${cut(meeting.summary, 60)}`);
  // 같은 내용의 요청이 여럿이면(다시 응답해 중복 저장된 경우 등) 확인사항에는 한 번만 올린다
  const seenReq = new Set<string>();
  const checkReqs = reqLines.filter((x) => {
    const k = x.content.replace(/\s+/g, ' ').trim();
    if (seenReq.has(k)) return false;
    seenReq.add(k);
    return true;
  });
  for (const x of checkReqs.slice(0, 2)) checks.push(`'${cut(x.content, 40)}' 진행상황 공유` + (x.due ? ` (${x.due})` : ''));
  if (c.recentInterests) checks.push(`최근 관심 주제 '${cut(c.recentInterests, 30)}' 관련 의견 청취`);
  if (evs.length && diffDays(today, evs[0][1]) <= 14) checks.push(`${evs[0][0]}(${mdLabel(evs[0][1])}) 축하 인사`);
  if (!c.foodLikes && !c.foodDislikes) checks.push('식사 자리라면 선호·기피 음식 자연스럽게 확인');
  else if (!c.hobbies && !c.recentInterests) checks.push('대화 중 취미·관심사 파악');
  const five = checks.slice(0, 5);

  const textLen = lines.reduce((s, l) => s + len(l.label) + len(l.value), 0) + five.reduce((s, x) => s + len(x), 0);
  return {
    customer: { id: c.id, name: c.name, position: c.position, company: c.company, department: c.department, customerType: c.customerType, updatedAt: c.updatedAt, mobile: c.mobile },
    meeting,
    lines,
    checks: five,
    openRequests: reqLines,
    readSeconds: Math.max(10, pyRound(textLen / 12)),
    note: '이 브라우저에 저장된 고객정보를 규칙에 따라 정리한 브리핑입니다. (규칙 기반 · 외부 전송 없음)',
  };
}

export interface UpcomingMeeting extends Interaction {
  name: string;
  position: string;
  company: string;
}
/** 앞으로 days일 안의 예정 미팅(날짜·시각 순) */
export function upcomingMeetings(a: AssistantData, now: Date, days = 14): UpcomingMeeting[] {
  const t = ymd(now);
  const end = addDays(t, days);
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  return sortStable(
    a.interactions.filter((i) => i.type === '미팅' && i.date >= t && i.date <= end && byId.has(i.customerId)),
    (x, y) => cmpStr(x.date, y.date) || cmpStr(x.time, y.time),
  ).map((i) => ({ ...i, name: byId.get(i.customerId)!.name, position: byId.get(i.customerId)!.position, company: byId.get(i.customerId)!.company }));
}
