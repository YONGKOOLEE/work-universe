// AI 비서 데이터 명령 — 고객 등록·수정·삭제, 변경 이력·복원, 중복 확인, 활동·요청·기념일, 최근 연락일 자동 갱신.
// 원본: ClientMemory app/db.py(create/update_customer, find_duplicates, apply/recompute_activity_dates, add_history)와 app/server.py의 clean_*·api_*.
// 순수 함수: AssistantData(draft)를 직접 고친다(store의 update 안에서 쓴다). 현재 시각은 now 인자로 받고, 브라우저 기능을 쓰지 않는다.
// 오류는 예외 대신 { error } 로 돌려준다(lib/people.ts와 같은 방식).
import type { AppState } from '../lib/types';
import { leadCoversDept } from '../lib/orgs';
import { nextId } from '../lib/util';
import { DATE_RE, isValidDate, stamp, ymd } from './dates';
import {
  ANNIVERSARY_KINDS,
  CUSTOMER_TYPES,
  DATE_FIELDS,
  DEFAULT_CONF,
  FIELD_KEYS,
  FIELD_LABELS,
  INTERACTION_TYPES,
  REQUEST_STATUSES,
  type Anniversary,
  type AssistantData,
  type ChangeEntry,
  type ChangeSource,
  type CustRequest,
  type Customer,
  type CustomerFieldKey,
  type CustomerFields,
  type Interaction,
} from './types';

/** 고객 한 명의 변경 이력 보관 상한(CR-25 2.3-8). 넘으면 오래된 것부터 지운다 */
export const HISTORY_LIMIT_PER_CUSTOMER = 200;

export type Err = { error: string };
export const isErr = (r: unknown): r is Err => !!r && typeof r === 'object' && 'error' in (r as object);

export const emptyAssistant = (): AssistantData => ({
  customers: [],
  interactions: [],
  requests: [],
  anniversaries: [],
  changes: [],
  followups: [],
  noticeRead: [],
  conf: { ...DEFAULT_CONF },
});
/** 읽기용: 없으면 빈 데이터(저장하지 않는다) */
export const assistantOf = (s: Pick<AppState, 'assistant'>): AssistantData => s.assistant ?? emptyAssistant();
/** 쓰기용: 없으면 빈 데이터를 만들어 붙인다(가상 고객을 다시 채우지 않는다) */
export function ensureAssistant(s: AppState): AssistantData {
  if (!s.assistant) s.assistant = emptyAssistant();
  return s.assistant;
}

// ───────────── 권한 ─────────────

/**
 * 고객을 고칠 수 있는가(열람은 모두 가능). 고객의 담당 영업자(ownerId) 본인,
 * 또는 담당 영업자의 소속 조직이 내 조직 범위(아래 조직 포함)인 살아 있는 조직장(전출·퇴직 제외).
 * 업무의 canEdit과 같은 규칙(lib/orgs.ts의 leadCoversDept)을 쓴다.
 */
export function canEditCustomer(s: AppState, customerId: string, userId: string): boolean {
  const c = s.assistant?.customers.find((x) => x.id === customerId);
  if (!c) return false;
  if (c.ownerId === userId) return true;
  const owner = s.users.find((u) => u.id === c.ownerId);
  return !!owner && leadCoversDept(s, owner.dept, userId);
}

// ───────────── 값 정리·검사 ─────────────

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

/** 날짜 항목 검사. 문제가 없으면 '' */
export function dateError(value: string, label = '날짜', required = false): string {
  const v = str(value);
  if (!v) return required ? `${label}을(를) 입력해 주세요.` : '';
  if (!DATE_RE.test(v)) return `${label} 형식이 올바르지 않습니다. (예: 2026-11-05)`;
  if (!isValidDate(v)) return `${label}이(가) 존재하지 않는 날짜입니다.`;
  return '';
}

/** 허용된 항목만 남기고 글로 정리(앞뒤 공백 제거·4000자). 고객 유형이 목록에 없으면 「기타」 */
export function cleanFields(data: Partial<Record<CustomerFieldKey, unknown>>): Partial<CustomerFields> {
  const out: Partial<CustomerFields> = {};
  for (const k of FIELD_KEYS) {
    if (k in data) out[k] = str(data[k]).slice(0, 4000);
  }
  if (out.customerType && !(CUSTOMER_TYPES as readonly string[]).includes(out.customerType)) out.customerType = '기타';
  return out;
}

function firstDateError(fields: Partial<CustomerFields>): string {
  for (const k of DATE_FIELDS) {
    const e = k in fields ? dateError(fields[k] ?? '', FIELD_LABELS[k]) : '';
    if (e) return e;
  }
  return '';
}

const blankFields = (): CustomerFields => Object.fromEntries(FIELD_KEYS.map((k) => [k, ''])) as unknown as CustomerFields;

// ───────────── 변경 이력 ─────────────

function addChange(a: AssistantData, customerId: string, field: string, oldValue: string, newValue: string, source: string, note: string, when: string) {
  const e: ChangeEntry = { id: nextId('CH', a.changes.map((x) => x.id)), customerId, field, oldValue: oldValue || '', newValue: newValue || '', source, note, changedAt: when };
  a.changes.push(e);
  trimChanges(a, customerId);
}

/** 고객 한 명의 이력이 상한을 넘으면 오래된 것부터 지운다(배열 앞쪽이 오래된 것) */
export function trimChanges(a: AssistantData, customerId: string, limit = HISTORY_LIMIT_PER_CUSTOMER) {
  const mine = a.changes.filter((c) => c.customerId === customerId);
  if (mine.length <= limit) return;
  const drop = new Set(mine.slice(0, mine.length - limit).map((c) => c.id));
  a.changes = a.changes.filter((c) => !drop.has(c.id));
}

// ───────────── 고객 ─────────────

export interface DuplicateHit {
  customer: Customer;
  reasons: string[];
}
const digits = (s: string) => (s || '').replace(/\D/g, '');

/** 이름+소속 일치, 휴대전화 일치(8자리 이상), 이메일 일치를 중복 후보로 돌려준다. 이름만 같으면 「이름 일치」 */
export function findDuplicates(a: AssistantData, data: Partial<Record<CustomerFieldKey, unknown>>, excludeId?: string): DuplicateHit[] {
  const name = str(data.name);
  const company = str(data.company);
  const mobile = digits(str(data.mobile));
  const email = str(data.email).toLowerCase();
  const out: DuplicateHit[] = [];
  for (const c of a.customers) {
    if (excludeId && c.id === excludeId) continue;
    const reasons: string[] = [];
    if (name && c.name === name && company && (c.company || '') === company) reasons.push('이름·소속 일치');
    else if (name && c.name === name) reasons.push('이름 일치');
    if (mobile && mobile.length >= 8 && digits(c.mobile) === mobile) reasons.push('휴대전화 일치');
    if (email && (c.email || '').toLowerCase() === email) reasons.push('이메일 일치');
    if (reasons.length) out.push({ customer: c, reasons });
  }
  return out;
}

export interface CreateOpts {
  now: Date;
  /** 담당 영업자(AppState.users의 ID) */
  ownerId: string;
  source?: ChangeSource;
  isDemo?: boolean;
  /** 중복 후보가 있어도 등록 */
  force?: boolean;
}

/** 고객 등록. 이름 필수·날짜 형식 검사·중복 후보(force가 아니면 등록하지 않고 후보를 돌려줌). 데모 고객은 등록 이력을 저장하지 않는다 */
export function createCustomer(a: AssistantData, data: Partial<Record<CustomerFieldKey, unknown>>, o: CreateOpts): { id: string } | Err | { duplicates: DuplicateHit[] } {
  const fields = cleanFields(data);
  if (!fields.name) return { error: '이름은 필수 입력 항목입니다.' };
  const de = firstDateError(fields);
  if (de) return { error: de };
  if (!o.force) {
    const dups = findDuplicates(a, fields);
    if (dups.length) return { duplicates: dups };
  }
  const ts = stamp(o.now);
  const id = nextId('CU', a.customers.map((c) => c.id));
  const c: Customer = { ...blankFields(), ...fields, id, ownerId: o.ownerId, isDemo: !!o.isDemo, createdAt: ts, updatedAt: ts };
  a.customers.push(c);
  if (!o.isDemo) {
    for (const k of FIELD_KEYS) if (fields[k]) addChange(a, id, k, '', fields[k]!, o.source ?? 'manual', '최초 등록', ts);
  }
  return { id };
}

export interface UpdateOpts {
  now: Date;
  source?: ChangeSource;
  note?: string;
}

/** 고객 항목 수정. 바뀐 항목마다 변경 이력(변경 전·후, 출처)을 남기고 바뀐 항목 이름 목록을 돌려준다 */
export function updateCustomer(a: AssistantData, id: string, patch: Partial<Record<CustomerFieldKey, unknown>>, o: UpdateOpts): { changed: CustomerFieldKey[] } | Err {
  const cur = a.customers.find((c) => c.id === id);
  if (!cur) return { error: '고객을 찾을 수 없습니다.' };
  const fields = cleanFields(patch);
  if ('name' in fields && !fields.name) return { error: '이름은 비워둘 수 없습니다.' };
  const de = firstDateError(fields);
  if (de) return { error: de };
  const ts = stamp(o.now);
  const changed: CustomerFieldKey[] = [];
  for (const k of FIELD_KEYS) {
    if (!(k in fields)) continue;
    const v = fields[k]!;
    const old = cur[k] || '';
    if (old !== v) {
      cur[k] = v;
      addChange(a, id, k, old, v, o.source ?? 'manual', o.note ?? '', ts);
      changed.push(k);
    }
  }
  if (changed.length) cur.updatedAt = ts;
  return { changed };
}

/** 고객 삭제 — 활동·요청·기념일·변경 이력·미팅 후 질문 상태를 함께 지운다 */
export function deleteCustomer(a: AssistantData, id: string): { removed: { interactions: number; requests: number; anniversaries: number; changes: number } } | Err {
  if (!a.customers.some((c) => c.id === id)) return { error: '고객을 찾을 수 없습니다.' };
  const iids = new Set(a.interactions.filter((i) => i.customerId === id).map((i) => i.id));
  const removed = {
    interactions: iids.size,
    requests: a.requests.filter((r) => r.customerId === id).length,
    anniversaries: a.anniversaries.filter((x) => x.customerId === id).length,
    changes: a.changes.filter((c) => c.customerId === id).length,
  };
  a.customers = a.customers.filter((c) => c.id !== id);
  a.interactions = a.interactions.filter((i) => i.customerId !== id);
  a.requests = a.requests.filter((r) => r.customerId !== id);
  a.anniversaries = a.anniversaries.filter((x) => x.customerId !== id);
  a.changes = a.changes.filter((c) => c.customerId !== id);
  a.followups = a.followups.filter((f) => !iids.has(f.interactionId));
  return { removed };
}

/** 변경 이력의 「이전 값」으로 되돌린다(복원도 새 이력으로 남는다). 이름을 빈 값으로 되돌릴 수는 없다 */
export function restoreChange(a: AssistantData, changeId: string, now: Date): { field: CustomerFieldKey; value: string } | Err {
  const h = a.changes.find((c) => c.id === changeId);
  if (!h) return { error: '변경 이력을 찾을 수 없습니다.' };
  if (!(FIELD_KEYS as string[]).includes(h.field)) return { error: '이 항목은 복원할 수 없습니다.' };
  if (h.field === 'name' && !h.oldValue) return { error: '이름을 빈 값으로 복원할 수 없습니다.' };
  if (!a.customers.some((c) => c.id === h.customerId)) return { error: '고객을 찾을 수 없습니다.' };
  const r = updateCustomer(a, h.customerId, { [h.field]: h.oldValue }, { now, source: 'restore', note: `${h.changedAt} 변경 이전 값으로 복원` });
  if (isErr(r)) return r;
  return { field: h.field as CustomerFieldKey, value: h.oldValue };
}

// ───────────── 최근 연락일·미팅일 자동 갱신 ─────────────

const CONTACT_TYPES = ['미팅', '통화', '이메일'];

/** 활동기록을 더할 때 최근 연락일/최근 미팅일을 올린다(오늘 이후 날짜의 예정 기록은 건드리지 않는다) */
export function applyActivityDates(a: AssistantData, customerId: string, type: string, date: string, now: Date) {
  if (!date || date > ymd(now)) return;
  if (!CONTACT_TYPES.includes(type)) return;
  const cur = a.customers.find((c) => c.id === customerId);
  if (!cur) return;
  const upd: Partial<Record<CustomerFieldKey, string>> = {};
  if ((cur.lastContactDate || '') < date) upd.lastContactDate = date;
  if (type === '미팅' && (cur.lastMeetingDate || '') < date) upd.lastMeetingDate = date;
  if (Object.keys(upd).length) updateCustomer(a, customerId, upd, { now, source: 'activity', note: `${type} 기록 추가` });
}

/** 활동기록을 고치거나 지운 뒤 최근 연락일/최근 미팅일을 다시 계산한다(지금까지의 기록 중 가장 늦은 날짜) */
export function recomputeActivityDates(a: AssistantData, customerId: string, now: Date) {
  const t = ymd(now);
  const mine = a.interactions.filter((i) => i.customerId === customerId && i.date <= t);
  const max = (xs: Interaction[]) => xs.reduce((m, i) => (i.date > m ? i.date : m), '');
  const lc = max(mine.filter((i) => CONTACT_TYPES.includes(i.type)));
  const lm = max(mine.filter((i) => i.type === '미팅'));
  updateCustomer(a, customerId, { lastContactDate: lc, lastMeetingDate: lm }, { now, source: 'activity', note: '활동기록 변경에 따른 재계산' });
}

// ───────────── 활동(미팅·통화 등) ─────────────

const TIME_RE = /^\d{2}:\d{2}$/;

interface InteractionPatch {
  type?: string;
  date?: string;
  time?: string;
  endTime?: string;
  title?: string;
  summary?: string;
  details?: string;
}

/** 활동 입력 정리(원본 clean_interaction). partial이면 들어온 항목만 */
function cleanInteraction(data: InteractionPatch, partial: boolean, existingTime = ''): Partial<Interaction> | Err {
  const out: Partial<Interaction> = {};
  if (!partial || data.type !== undefined) {
    const t = str(data.type) || '메모';
    out.type = (INTERACTION_TYPES as readonly string[]).includes(t) ? t : '기타';
  }
  if (!partial || data.date !== undefined) {
    const e = dateError(str(data.date), '날짜', true);
    if (e) return { error: e };
    out.date = str(data.date);
  }
  if (data.time !== undefined) {
    const tm = str(data.time);
    if (tm && !TIME_RE.test(tm)) return { error: '시간 형식이 올바르지 않습니다. (예: 14:30)' };
    out.time = tm;
  }
  if (data.endTime !== undefined) {
    const et = str(data.endTime);
    if (et && !TIME_RE.test(et)) return { error: '종료 시간 형식이 올바르지 않습니다. (예: 15:30)' };
    const start = out.time !== undefined ? out.time : existingTime;
    if (et && start && et <= start) return { error: '종료 시간은 시작 시간보다 늦어야 합니다.' };
    out.endTime = et;
  }
  if (!partial || data.title !== undefined) {
    const title = str(data.title);
    if (!title) return { error: '제목을 입력해 주세요.' };
    out.title = title.slice(0, 300);
  }
  for (const k of ['summary', 'details'] as const) if (data[k] !== undefined) out[k] = str(data[k]).slice(0, 20000);
  return out;
}

export interface AddInteractionOpts {
  now: Date;
  source?: string;
  sourceFile?: string;
  isDemo?: boolean;
}

/** 활동 추가. 오늘까지의 미팅·통화·이메일이면 고객의 최근 연락일(·미팅일)을 올린다 */
export function addInteraction(a: AssistantData, customerId: string, data: InteractionPatch, o: AddInteractionOpts): { id: string } | Err {
  if (!a.customers.some((c) => c.id === customerId)) return { error: '고객을 찾을 수 없습니다.' };
  const f = cleanInteraction(data, false);
  if (isErr(f)) return f;
  const i: Interaction = {
    id: nextId('IA', a.interactions.map((x) => x.id)),
    customerId,
    type: f.type!,
    date: f.date!,
    time: f.time ?? '',
    endTime: f.endTime ?? '',
    title: f.title!,
    summary: f.summary ?? '',
    details: f.details ?? '',
    source: o.source ?? 'manual',
    sourceFile: o.sourceFile ?? '',
    isDemo: !!o.isDemo,
    createdAt: stamp(o.now),
  };
  a.interactions.push(i);
  applyActivityDates(a, customerId, i.type, i.date, o.now);
  return { id: i.id };
}

export function updateInteraction(a: AssistantData, id: string, patch: InteractionPatch, now: Date): { ok: true } | Err {
  const row = a.interactions.find((i) => i.id === id);
  if (!row) return { error: '기록을 찾을 수 없습니다.' };
  const f = cleanInteraction(patch, true, row.time);
  if (isErr(f)) return f;
  Object.assign(row, f);
  recomputeActivityDates(a, row.customerId, now);
  return { ok: true };
}

export function deleteInteraction(a: AssistantData, id: string, now: Date): { ok: true } | Err {
  const row = a.interactions.find((i) => i.id === id);
  if (!row) return { error: '기록을 찾을 수 없습니다.' };
  a.interactions = a.interactions.filter((i) => i.id !== id);
  for (const r of a.requests) if (r.interactionId === id) r.interactionId = null; // 요청사항은 남기고 연결만 끊는다
  a.followups = a.followups.filter((f) => f.interactionId !== id);
  recomputeActivityDates(a, row.customerId, now);
  return { ok: true };
}

// ───────────── 요청사항 ─────────────

interface RequestPatch {
  content?: string;
  receivedDate?: string;
  dueDate?: string;
  status?: string;
  assignee?: string;
  result?: string;
  interactionId?: string | null;
}

function cleanRequest(data: RequestPatch, partial: boolean, now: Date): Partial<CustRequest> | Err {
  const out: Partial<CustRequest> = {};
  if (!partial || data.content !== undefined) {
    const c = str(data.content);
    if (!c) return { error: '요청 내용을 입력해 주세요.' };
    out.content = c.slice(0, 2000);
  }
  if (!partial || data.receivedDate !== undefined) {
    const v = str(data.receivedDate) || ymd(now);
    const e = dateError(v, '접수일');
    if (e) return { error: e };
    out.receivedDate = v;
  }
  if (data.dueDate !== undefined) {
    const e = dateError(str(data.dueDate), '처리기한');
    if (e) return { error: e };
    out.dueDate = str(data.dueDate);
  }
  if (!partial || data.status !== undefined) {
    const s = str(data.status) || '미착수';
    if (!(REQUEST_STATUSES as readonly string[]).includes(s)) return { error: '진행상태 값이 올바르지 않습니다.' };
    out.status = s;
  }
  for (const k of ['assignee', 'result'] as const) if (data[k] !== undefined) out[k] = str(data[k]).slice(0, 2000);
  if (data.interactionId !== undefined) out.interactionId = data.interactionId || null;
  return out;
}

export interface AddRequestOpts {
  now: Date;
  source?: string;
  isDemo?: boolean;
}

export function addRequest(a: AssistantData, customerId: string, data: RequestPatch, o: AddRequestOpts): { id: string } | Err {
  if (!a.customers.some((c) => c.id === customerId)) return { error: '고객을 찾을 수 없습니다.' };
  const f = cleanRequest(data, false, o.now);
  if (isErr(f)) return f;
  const ts = stamp(o.now);
  const r: CustRequest = {
    id: nextId('RQ', a.requests.map((x) => x.id)),
    customerId,
    content: f.content!,
    receivedDate: f.receivedDate!,
    dueDate: f.dueDate ?? '',
    status: f.status!,
    assignee: f.assignee ?? '',
    interactionId: f.interactionId ?? null,
    result: f.result ?? '',
    source: o.source ?? 'manual',
    isDemo: !!o.isDemo,
    createdAt: ts,
    updatedAt: ts,
  };
  a.requests.push(r);
  return { id: r.id };
}

export function updateRequest(a: AssistantData, id: string, patch: RequestPatch, now: Date): { ok: true } | Err {
  const row = a.requests.find((r) => r.id === id);
  if (!row) return { error: '요청사항을 찾을 수 없습니다.' };
  const f = cleanRequest(patch, true, now);
  if (isErr(f)) return f;
  Object.assign(row, f);
  row.updatedAt = stamp(now);
  return { ok: true };
}

export function deleteRequest(a: AssistantData, id: string): { ok: true } | Err {
  if (!a.requests.some((r) => r.id === id)) return { error: '요청사항을 찾을 수 없습니다.' };
  a.requests = a.requests.filter((r) => r.id !== id);
  return { ok: true };
}

// ───────────── 기념일·경조사 ─────────────

interface AnnivPatch {
  kind?: string;
  label?: string;
  date?: string;
  repeatYearly?: boolean;
  remindDays?: string;
  notes?: string;
}

/** 알림 시점 글('7, 2, 0')을 정리: 0~60 정수만, 비면 기본 '7,2,0' */
export function cleanRemindDays(v: string): string {
  const vals: string[] = [];
  for (const p of String(v ?? '').split(',')) {
    const t = p.trim();
    if (/^\d+$/.test(t) && Number(t) <= 60) vals.push(String(Number(t)));
  }
  return vals.join(',') || '7,2,0';
}

function cleanAnniv(data: AnnivPatch, partial: boolean): Partial<Anniversary> | Err {
  const out: Partial<Anniversary> = {};
  if (!partial || data.kind !== undefined) {
    const k = str(data.kind) || '기타 기념일';
    out.kind = (ANNIVERSARY_KINDS as readonly string[]).includes(k) ? k : '기타 기념일';
  }
  if (!partial || data.date !== undefined) {
    const e = dateError(str(data.date), '날짜', true);
    if (e) return { error: e };
    out.date = str(data.date);
  }
  if (data.repeatYearly !== undefined) out.repeatYearly = !!data.repeatYearly;
  for (const k of ['label', 'notes'] as const) if (data[k] !== undefined) out[k] = str(data[k]).slice(0, 500);
  if (data.remindDays !== undefined) out.remindDays = cleanRemindDays(data.remindDays);
  return out;
}

export function addAnniversary(a: AssistantData, customerId: string, data: AnnivPatch, o: { now: Date; isDemo?: boolean }): { id: string } | Err {
  if (!a.customers.some((c) => c.id === customerId)) return { error: '고객을 찾을 수 없습니다.' };
  const f = cleanAnniv(data, false);
  if (isErr(f)) return f;
  const x: Anniversary = {
    id: nextId('AN', a.anniversaries.map((y) => y.id)),
    customerId,
    kind: f.kind!,
    label: f.label ?? '',
    date: f.date!,
    repeatYearly: f.repeatYearly ?? true,
    remindDays: f.remindDays ?? '7,2,0',
    notes: f.notes ?? '',
    isDemo: !!o.isDemo,
    createdAt: stamp(o.now),
  };
  a.anniversaries.push(x);
  return { id: x.id };
}

export function updateAnniversary(a: AssistantData, id: string, patch: AnnivPatch): { ok: true } | Err {
  const row = a.anniversaries.find((x) => x.id === id);
  if (!row) return { error: '기념일을 찾을 수 없습니다.' };
  const f = cleanAnniv(patch, true);
  if (isErr(f)) return f;
  Object.assign(row, f);
  return { ok: true };
}

export function deleteAnniversary(a: AssistantData, id: string): { ok: true } | Err {
  if (!a.anniversaries.some((x) => x.id === id)) return { error: '기념일을 찾을 수 없습니다.' };
  a.anniversaries = a.anniversaries.filter((x) => x.id !== id);
  return { ok: true };
}

