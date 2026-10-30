// AI 비서 화면 보조 로직 — 화면(React)이 쓰는 순수 함수만 모았다(브라우저 기능 없음, Node 단위 시험 대상).
import type { AppState, User } from '../../lib/types';
import { isActiveLead, leadCoversDept } from '../../lib/orgs';
import { isLeft } from '../../lib/people';
import { nextId } from '../../lib/util';
import { stamp } from '../dates';
import { addChange, canEditCustomer, deleteCustomer, isErr, type Err } from '../model';
import { createAssistantSeed } from '../seed';
import type { Answers } from '../followup';
import { CUSTOMER_FIELDS, FIELD_KEYS, type AssistantData, type Customer, type CustomerFieldKey } from '../types';

// ───────────── 표시 ─────────────

/** 머리글자 아바타: 이름의 첫 글자(없으면 ?) */
export const initialOf = (name: string): string => Array.from((name ?? '').trim())[0] ?? '?';

/** 아바타 색 번호(0~5) — 같은 ID는 늘 같은 색 */
export function avatarTone(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 6;
}

/** D-day 글: 0 오늘, 양수 D-n, 음수 n일 경과, null은 빈 글 */
export function ddayLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n === 0) return '오늘';
  return n > 0 ? `D-${n}` : `${-n}일 경과`;
}

/** D-day 색 계열: 경과·오늘은 danger, 3일 이내 warn, 그 밖은 muted */
export function ddayTone(n: number | null | undefined): 'danger' | 'warn' | 'muted' {
  if (n === null || n === undefined) return 'muted';
  if (n <= 0) return 'danger';
  return n <= 3 ? 'warn' : 'muted';
}

export interface HighlightPart {
  text: string;
  hit: boolean;
}
/** 글에서 키워드가 나오는 곳을 표시용 조각으로 나눈다(대소문자 무시, 겹치면 합침). 키워드가 없으면 한 조각 */
export function highlightParts(text: string, keywords: string[]): HighlightPart[] {
  const src = String(text ?? '');
  const kws = [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0))];
  if (!src || !kws.length) return [{ text: src, hit: false }];
  const low = src.toLowerCase();
  const spans: [number, number][] = [];
  for (const k of kws) {
    const kl = k.toLowerCase();
    let from = 0;
    for (;;) {
      const i = low.indexOf(kl, from);
      if (i < 0) break;
      spans.push([i, i + kl.length]);
      from = i + Math.max(1, kl.length);
    }
  }
  if (!spans.length) return [{ text: src, hit: false }];
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const out: HighlightPart[] = [];
  let pos = 0;
  for (const [a, b] of merged) {
    if (a > pos) out.push({ text: src.slice(pos, a), hit: false });
    out.push({ text: src.slice(a, b), hit: true });
    pos = b;
  }
  if (pos < src.length) out.push({ text: src.slice(pos), hit: false });
  return out;
}

// ───────────── 고객 입력 양식 ─────────────

export type CustomerForm = Record<CustomerFieldKey, string>;
export const emptyForm = (): CustomerForm => Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as CustomerForm;
export const formOf = (c: Customer): CustomerForm => Object.fromEntries(FIELD_KEYS.map((k) => [k, c[k] ?? ''])) as CustomerForm;
/** 양식에서 원본과 다른 칸의 이름 목록(수정 대화상자의 「바뀐 칸」 표시) */
export function changedKeys(before: CustomerForm, after: CustomerForm): CustomerFieldKey[] {
  return CUSTOMER_FIELDS.map((f) => f.key).filter((k) => before[k].trim() !== after[k].trim());
}

// ───────────── 담당 영업자 ─────────────

/** 변경 이력에 담당 영업자 바꿈을 남길 때의 항목 이름(고객 항목이 아니므로 복원 대상이 아니다) */
export const OWNER_FIELD = 'ownerId';

/** 담당 영업자를 바꿀 수 있는가: 살아 있는 조직장이고(고객이 있으면) 그 고객을 고칠 수 있을 때 */
export function canChangeOwner(s: AppState, userId: string, customerId?: string | null): boolean {
  if (!isActiveLead(s, userId)) return false;
  return customerId ? canEditCustomer(s, customerId, userId) : true;
}
/** 담당 영업자 선택 목록: 지금 담당자 + 내 조직 범위(아래 조직 포함)의 재직자 */
export function ownerChoices(s: AppState, userId: string, currentOwnerId: string): User[] {
  return s.users.filter((u) => u.id === currentOwnerId || (!isLeft(u) && leadCoversDept(s, u.dept, userId)));
}
/** 담당 영업자 바꾸기(조직장 범위 안). 바뀐 것이 없으면 changed:false */
export function setCustomerOwner(s: AppState, a: AssistantData, customerId: string, ownerId: string, userId: string, now: Date): { changed: boolean } | Err {
  const c = a.customers.find((x) => x.id === customerId);
  if (!c) return { error: '고객을 찾을 수 없습니다.' };
  if (c.ownerId === ownerId) return { changed: false };
  if (!canChangeOwner(s, userId, customerId)) return { error: '담당 영업자는 담당자의 조직장만 바꿀 수 있습니다.' };
  if (!ownerChoices(s, userId, c.ownerId).some((u) => u.id === ownerId)) return { error: '내 조직 범위 밖의 사람은 담당으로 지정할 수 없습니다.' };
  const nameOf = (id: string) => s.users.find((u) => u.id === id)?.name ?? id;
  const before = c.ownerId;
  c.ownerId = ownerId;
  c.updatedAt = stamp(now);
  // 변경 이력에 남긴다(복원 대상은 아님 — 고객 항목이 아니라서 복원 단추가 나오지 않는다)
  addChange(a, customerId, OWNER_FIELD, nameOf(before), nameOf(ownerId), 'manual', '담당 영업자 변경', stamp(now));
  return { changed: true };
}

/** 담당 영업자 표시 이름(전출·퇴직이면 표시, 없는 사람이면 ID) */
export function ownerLabel(s: Pick<AppState, 'users'>, ownerId: string): string {
  const u = s.users.find((x) => x.id === ownerId);
  if (!u) return ownerId || '미지정';
  return isLeft(u) ? `${u.name} (전출·퇴직)` : u.name;
}

// ───────────── 가상 데이터 · 전체 삭제 ─────────────

export interface RestoreReport {
  added: number;
  /** 이름+소속이 같은 고객이 이미 있어 건너뛴 가상 고객 */
  skipped: { name: string; company: string }[];
}
/** 「1명 건너뜀: 김도현(같은 이름·소속 고객 있음)」 식 안내 글 */
export function restoreDemoMessage(r: RestoreReport): string {
  const head = r.added ? `가상 고객 ${r.added}명을 채웠습니다(담당: 지금 사용자)` : '더할 가상 고객이 없습니다';
  if (!r.skipped.length) return head;
  // 이름은 앞 5명까지 보이고 나머지는 「외 N명」으로 줄인다(전부 건너뛰면 18명이라 알림이 너무 길어진다)
  const SHOW = 5;
  const who = r.skipped.slice(0, SHOW).map((c) => `${c.name}(같은 이름·소속 고객 있음)`).join(', ');
  const more = r.skipped.length > SHOW ? ` 외 ${r.skipped.length - SHOW}명` : '';
  return `${head}. ${r.skipped.length}명 건너뜀: ${who}${more}`;
}

/** restoreDemo와 같지만 건너뛴 고객도 알려 준다 */
export function restoreDemoReport(a: AssistantData, now: Date, ownerId: string): RestoreReport {
  const seed = createAssistantSeed(now, ownerId);
  const key = (c: Pick<Customer, 'name' | 'company'>) => `${c.name}|${c.company}`;
  const have = new Set(a.customers.map(key));
  let added = 0;
  const skipped: RestoreReport['skipped'] = [];
  for (const c of seed.customers) {
    if (have.has(key(c))) {
      skipped.push({ name: c.name, company: c.company });
      continue;
    }
    have.add(key(c));
    const id = nextId('CU', a.customers.map((x) => x.id));
    a.customers.push({ ...c, id });
    const iMap = new Map<string, string>();
    for (const i of seed.interactions.filter((x) => x.customerId === c.id)) {
      const nid = nextId('IA', a.interactions.map((x) => x.id));
      iMap.set(i.id, nid);
      a.interactions.push({ ...i, id: nid, customerId: id });
    }
    for (const r of seed.requests.filter((x) => x.customerId === c.id)) {
      a.requests.push({ ...r, id: nextId('RQ', a.requests.map((x) => x.id)), customerId: id, interactionId: r.interactionId ? iMap.get(r.interactionId) ?? null : null });
    }
    for (const n of seed.anniversaries.filter((x) => x.customerId === c.id)) {
      a.anniversaries.push({ ...n, id: nextId('AN', a.anniversaries.map((x) => x.id)), customerId: id });
    }
    added += 1;
  }
  return { added, skipped };
}
/** 가상 고객을 다시 채운다. 이름+소속이 같은 고객이 이미 있으면 건너뛴다. 새 고객은 새 ID로 하위 기록과 함께 더한다. 더한 고객 수 */
export const restoreDemo = (a: AssistantData, now: Date, ownerId: string): number => restoreDemoReport(a, now, ownerId).added;

/** 지우기 대상 고객 ID: 내가 고칠 수 있는 고객 중 가상(demo)만 또는 전부 */
export function deletableIds(s: AppState, userId: string, scope: 'demo' | 'all'): string[] {
  const a = s.assistant;
  if (!a) return [];
  return a.customers.filter((c) => (scope === 'all' || c.isDemo) && canEditCustomer(s, c.id, userId)).map((c) => c.id);
}
/** 고객을 지운다(하위 기록 함께). 지운 고객 수. 모든 고객이 없어져도 assistant 칸은 남아 가상 고객을 다시 채우지 않는다 */
export function deleteCustomers(a: AssistantData, ids: string[]): number {
  let n = 0;
  for (const id of ids) if (!isErr(deleteCustomer(a, id))) n += 1;
  if (!a.customers.length) a.noticeRead = [];
  return n;
}

// ───────────── 미팅 후 질문 답변 ─────────────

/** 질문의 선택지를 고른다(이전 입력은 지운다). value가 같으면 그대로 */
export function pickOption(answers: Answers, qid: string, value: string): Answers {
  if (answers[qid]?.value === value) return answers;
  return { ...answers, [qid]: { value } };
}
/** 선택지의 입력칸 값을 바꾼다. 고른 선택지가 없으면 변경 없음 */
export function setAnswerInput(answers: Answers, qid: string, key: string, text: string): Answers {
  const cur = answers[qid];
  if (!cur?.value) return answers;
  return { ...answers, [qid]: { ...cur, [key]: text } };
}
/** 질문 하나의 답을 지운다(건너뛰기) */
export function clearAnswer(answers: Answers, qid: string): Answers {
  if (!(qid in answers)) return answers;
  const next = { ...answers };
  delete next[qid];
  return next;
}

// ───────────── 이동 경로 ─────────────

export type CustomerTab = 'overview' | 'prefs' | 'history' | 'requests' | 'events' | 'changes';
export const CUSTOMER_TABS: CustomerTab[] = ['overview', 'prefs', 'history', 'requests', 'events', 'changes'];
export const isCustomerTab = (v: string | null | undefined): v is CustomerTab => !!v && (CUSTOMER_TABS as string[]).includes(v);

export const customerPath = (id: string, tab?: CustomerTab) => `/assistant/customers/${id}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`;
export const followupPath = (interactionId: string) => `/assistant/followup/${interactionId}`;

/** 알림을 눌렀을 때 갈 곳 */
export function noticePath(l: { to: 'customer-requests' | 'customer-events' | 'briefing' | 'followup'; customerId: string; interactionId?: string }): string {
  switch (l.to) {
    case 'customer-requests':
      return customerPath(l.customerId, 'requests');
    case 'customer-events':
      return customerPath(l.customerId, 'events');
    case 'briefing':
      return `${customerPath(l.customerId)}${customerPath(l.customerId).includes('?') ? '&' : '?'}briefing=${l.interactionId ?? '1'}`;
    case 'followup':
      return l.interactionId ? followupPath(l.interactionId) : customerPath(l.customerId, 'history');
  }
}
/** 검색 결과 근거를 눌렀을 때 갈 곳 */
export function evidencePath(l: { to: 'customer-history' | 'customer-requests' | 'customer-events'; customerId: string }): string {
  return customerPath(l.customerId, l.to === 'customer-history' ? 'history' : l.to === 'customer-requests' ? 'requests' : 'events');
}
