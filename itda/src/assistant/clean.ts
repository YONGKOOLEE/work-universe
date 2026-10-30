// 불러온 AI 비서 데이터 정리 — 저장된 데이터·백업 파일의 assistant 칸이 깨져 있어도 앱이 멈추지 않게 한다(migrate.ts가 부른다).
// 모양이 틀린 항목·없는 고객을 가리키는 하위 기록·잘못된 날짜의 활동은 버리고, 나머지는 그대로 둔다(올바른 데이터는 바꾸지 않는다: 두 번 해도 같은 결과).
import { isValidDate } from './dates';
import { cleanRemindDays, emptyAssistant } from './model';
import { validateConf, NOTICE_READ_LIMIT } from './notices';
import { DEFAULT_CONF, FIELD_KEYS, type Anniversary, type AssistantConf, type AssistantData, type ChangeEntry, type CustRequest, type Customer, type FollowupState, type Interaction } from './types';
import { DATE_FIELDS } from './types';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown) => (typeof x === 'string' ? x : x == null ? '' : typeof x === 'number' || typeof x === 'boolean' ? String(x) : '');
const objs = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isObj) : []);
const okDate = (x: unknown) => (typeof x === 'string' && isValidDate(x) ? x : '');
const okTime = (x: unknown) => (typeof x === 'string' && /^\d{2}:\d{2}$/.test(x) ? x : '');

/**
 * raw(assistant 칸)를 올바른 AssistantData로. undefined는 이 함수가 받지 않는다(호출한 쪽이 「처음 열기」로 가상 고객을 채운다).
 * 객체가 아니면 빈 데이터 — 깨진 칸을 가상 고객으로 되살리지 않는다.
 * fallbackOwnerId: 담당 영업자가 빠진 고객에 붙일 사람(보통 지금 사용자).
 */
export function cleanAssistant(raw: unknown, fallbackOwnerId = ''): AssistantData {
  if (!isObj(raw)) return emptyAssistant();
  const out = emptyAssistant();
  const seen = new Set<string>();
  const fresh = (id: string, bag: Set<string>) => {
    if (!id || bag.has(id)) return false;
    bag.add(id);
    return true;
  };

  const custIds = new Set<string>();
  for (const c of objs(raw.customers)) {
    const id = str(c.id);
    const name = str(c.name).trim();
    if (!name || !fresh(id, custIds)) continue;
    const cust = Object.fromEntries(FIELD_KEYS.map((k) => [k, str(c[k])])) as unknown as Customer;
    for (const k of DATE_FIELDS) cust[k] = okDate(c[k]);
    cust.name = name;
    out.customers.push({ ...cust, id, ownerId: str(c.ownerId) || fallbackOwnerId, isDemo: !!c.isDemo, createdAt: str(c.createdAt), updatedAt: str(c.updatedAt) });
  }

  seen.clear();
  for (const i of objs(raw.interactions)) {
    const id = str(i.id);
    const cid = str(i.customerId);
    const date = okDate(i.date);
    if (!date || !custIds.has(cid) || !str(i.title) || !fresh(id, seen)) continue;
    out.interactions.push({
      id, customerId: cid, type: str(i.type) || '메모', date, time: okTime(i.time), endTime: okTime(i.endTime), title: str(i.title), summary: str(i.summary), details: str(i.details),
      source: str(i.source) || 'manual', sourceFile: str(i.sourceFile), isDemo: !!i.isDemo, createdAt: str(i.createdAt),
    } as Interaction);
  }
  const iids = new Set(out.interactions.map((i) => i.id));

  seen.clear();
  for (const r of objs(raw.requests)) {
    const id = str(r.id);
    const cid = str(r.customerId);
    if (!custIds.has(cid) || !str(r.content) || !fresh(id, seen)) continue;
    const iid = str(r.interactionId);
    out.requests.push({
      id, customerId: cid, content: str(r.content), receivedDate: okDate(r.receivedDate), dueDate: okDate(r.dueDate), status: str(r.status) || '미착수', assignee: str(r.assignee),
      interactionId: iid && iids.has(iid) ? iid : null, result: str(r.result), source: str(r.source) || 'manual', isDemo: !!r.isDemo, createdAt: str(r.createdAt), updatedAt: str(r.updatedAt),
    } as CustRequest);
  }

  seen.clear();
  for (const a of objs(raw.anniversaries)) {
    const id = str(a.id);
    const cid = str(a.customerId);
    const date = okDate(a.date);
    if (!custIds.has(cid) || !date || !fresh(id, seen)) continue;
    out.anniversaries.push({
      id, customerId: cid, kind: str(a.kind) || '기타 기념일', label: str(a.label), date, repeatYearly: a.repeatYearly === undefined ? true : !!a.repeatYearly,
      remindDays: cleanRemindDays(str(a.remindDays)), notes: str(a.notes), isDemo: !!a.isDemo, createdAt: str(a.createdAt),
    } as Anniversary);
  }

  seen.clear();
  for (const h of objs(raw.changes)) {
    const id = str(h.id);
    const cid = str(h.customerId);
    if (!custIds.has(cid) || !str(h.field) || !fresh(id, seen)) continue;
    out.changes.push({ id, customerId: cid, field: str(h.field), oldValue: str(h.oldValue), newValue: str(h.newValue), source: str(h.source) || 'manual', note: str(h.note), changedAt: str(h.changedAt) } as ChangeEntry);
  }

  seen.clear();
  for (const f of objs(raw.followups)) {
    const iid = str(f.interactionId);
    if (!iids.has(iid) || !fresh(iid, seen)) continue;
    const answers: FollowupState['answers'] = {};
    if (isObj(f.answers)) for (const [q, v] of Object.entries(f.answers)) if (isObj(v)) answers[q] = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, str(x)]));
    out.followups.push({
      interactionId: iid, status: f.status === 'done' || f.status === 'skipped' ? f.status : 'pending', answers,
      asked: Array.isArray(f.asked) ? f.asked.filter((x): x is string => typeof x === 'string') : [], updatedAt: str(f.updatedAt),
    });
  }

  out.noticeRead = Array.isArray(raw.noticeRead) ? [...new Set(raw.noticeRead.filter((x): x is string => typeof x === 'string'))].slice(-NOTICE_READ_LIMIT) : [];

  // 설정: 항목마다 검사해 올바른 것만 받는다
  let conf: AssistantConf = { ...DEFAULT_CONF };
  if (isObj(raw.conf)) {
    for (const k of Object.keys(DEFAULT_CONF) as (keyof AssistantConf)[]) {
      if (!(k in raw.conf)) continue;
      const r = validateConf(conf, { [k]: raw.conf[k] });
      if ('conf' in r) conf = r.conf;
    }
  }
  out.conf = conf;
  return out;
}
