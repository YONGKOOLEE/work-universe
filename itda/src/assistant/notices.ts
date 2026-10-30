// 알림 — 요청 기한·생일·기념일·예정 미팅(전날·1시간 전)·미팅 후 질문. 저장하지 않고 그때그때 계산한다(원본 notify.py의 candidates 규칙).
// Windows 알림·브라우저 알림·창이 닫힌 뒤의 알림은 없다(서버 없는 HTML 파일은 백그라운드로 못 돈다). 탭을 연 동안 메뉴 숫자와 오늘 화면에만 보인다.
// 같은 알림을 두 번 세지 않도록 고유 키(trigger key)를 쓴다: 읽음 표시는 AssistantData.noticeRead에 키만 저장한다.
// 이미 지나간 알림 시점이 여럿이면 가장 최근 시점 1건만 만든다(원본과 같음). 완료한 요청·지운 일정·지난 일정은 후보에서 빠지므로 따로 「처리됨」 정리가 필요 없다.
import { addDays, diffDays, isValidDate, nextOccurrence, stamp, ymd } from './dates';
import { pending } from './followup';
import { sortStable } from './queries';
import { filterAssistant } from './scope';
import type { AssistantConf, AssistantData } from './types';

export type NoticeKind = 'request' | 'birthday' | 'anniversary' | 'meeting' | 'followup';
export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = { request: '요청 기한', birthday: '생일', anniversary: '기념일', meeting: '미팅', followup: '미팅 후 질문' };

/** 알림을 누르면 갈 곳(화면이 경로로 바꾼다) */
export interface NoticeLink {
  to: 'customer-requests' | 'customer-events' | 'briefing' | 'followup';
  customerId: string;
  interactionId?: string;
}
export interface Notice {
  /** 고유 키 — 읽음 표시의 기준 */
  key: string;
  kind: NoticeKind;
  /** 요청·기념일·미팅의 ID(생일은 고객 ID) */
  refId: string;
  customerId: string;
  eventDate: string;
  /** 알림이 뜨는 시각 'YYYY-MM-DD HH:MM:SS' */
  fireAt: string;
  title: string;
  body: string;
  link: NoticeLink;
  read: boolean;
}

/** '7,2,0' → [7,2,0] (0~60 정수만, 큰 수부터) */
export function parseDays(s: string): number[] {
  const out = new Set<number>();
  for (const p of String(s ?? '').split(',')) {
    const t = p.trim();
    if (/^\d+$/.test(t) && Number(t) <= 60) out.add(Number(t));
  }
  return [...out].sort((x, y) => y - x);
}

const at = (day: string, hm: string) => {
  const m = /^(\d+):(\d+)$/.exec(hm);
  const [h, mi] = m ? [Number(m[1]), Number(m[2])] : [9, 0];
  return `${day} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00`;
};
const ddayLabel = (n: number) => (n === 0 ? '오늘' : n === 1 ? '내일' : `D-${n}`);

/** 이미 도래한 알림 시점 중 가장 최근 것(없으면 null) */
function latestOffset(eventDay: string, offsets: number[], nowS: string, hm: string): { off: number; fire: string } | null {
  let best: { off: number; fire: string } | null = null;
  for (const off of offsets) {
    const fire = at(addDays(eventDay, -off), hm);
    if (fire <= nowS) best = { off, fire };
  }
  return best;
}

type Cand = Omit<Notice, 'read'>;

/** 지금 시점의 알림 후보 전부(읽음 표시 전). 생성 순서: 요청 → 생일 → 기념일 → 미팅 → 미팅 후 질문. ids를 주면 그 고객들의 알림만 */
export function candidates(a0: AssistantData, now: Date, ids?: ReadonlySet<string> | null): Cand[] {
  const a = filterAssistant(a0, ids);
  const conf = a.conf;
  const nowS = stamp(now);
  const today = ymd(now);
  const hm = conf.notifyTime;
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  const out: Cand[] = [];
  const pos = (c: { position: string }) => c.position || '';
  const co = (c: { company: string }) => c.company || '';

  // 1) 요청사항 처리기한(완료 건 제외)
  const reqOffsets = parseDays(conf.reqRemind);
  for (const r of a.requests) {
    const c = byId.get(r.customerId);
    if (!c || r.status === '완료' || !r.dueDate || !isValidDate(r.dueDate) || r.dueDate < today) continue;
    const hit = latestOffset(r.dueDate, reqOffsets, nowS, hm);
    if (!hit) continue;
    const n = diffDays(today, r.dueDate);
    out.push({
      key: `req:${r.id}:${r.dueDate}:${hit.off}`, kind: 'request', refId: r.id, customerId: r.customerId, eventDate: r.dueDate, fireAt: hit.fire,
      title: `[요청 기한 ${ddayLabel(n)}] ${c.name} ${pos(c)} · ${r.content}`,
      body: `처리기한 ${r.dueDate} · 현재 상태 '${r.status}' · ${co(c)}`,
      link: { to: 'customer-requests', customerId: r.customerId },
    });
  }

  // 2) 고객 생일
  const bdayOffsets = parseDays(conf.bdayRemind);
  for (const c of a.customers) {
    if (!c.birthDate) continue;
    const nxt = nextOccurrence(c.birthDate, today);
    if (!nxt) continue;
    const hit = latestOffset(nxt, bdayOffsets, nowS, hm);
    if (!hit) continue;
    const n = diffDays(today, nxt);
    out.push({
      key: `bday:${c.id}:${nxt}:${hit.off}`, kind: 'birthday', refId: c.id, customerId: c.id, eventDate: nxt, fireAt: hit.fire,
      title: `[생일 ${ddayLabel(n)}] ${c.name} ${pos(c)} (${co(c)})`,
      body: `${Number(nxt.slice(5, 7))}월 ${Number(nxt.slice(8, 10))}일 생일 · 축하 연락을 검토하세요`,
      link: { to: 'customer-events', customerId: c.id },
    });
  }

  // 3) 기념일(기념일별 알림 시점)
  for (const an of a.anniversaries) {
    const c = byId.get(an.customerId);
    if (!c) continue;
    let nxt: string | null;
    if (an.repeatYearly) nxt = nextOccurrence(an.date, today);
    else {
      nxt = isValidDate(an.date) ? an.date : null;
      if (nxt && nxt < today) nxt = null;
    }
    if (!nxt) continue;
    const hit = latestOffset(nxt, parseDays(an.remindDays || '7,2,0'), nowS, hm);
    if (!hit) continue;
    const n = diffDays(today, nxt);
    const label = an.label || an.kind;
    out.push({
      key: `anniv:${an.id}:${nxt}:${hit.off}`, kind: 'anniversary', refId: an.id, customerId: an.customerId, eventDate: nxt, fireAt: hit.fire,
      title: `[${label} ${ddayLabel(n)}] ${c.name} ${pos(c)} (${co(c)})`,
      body: `${Number(nxt.slice(5, 7))}월 ${Number(nxt.slice(8, 10))}일 ${an.kind}${an.notes ? ` · ${an.notes}` : ''}`,
      link: { to: 'customer-events', customerId: an.customerId },
    });
  }

  // 4) 예정 미팅 → 전날·1시간 전 브리핑 알림
  for (const m of a.interactions) {
    const c = byId.get(m.customerId);
    if (!c || m.type !== '미팅' || !isValidDate(m.date) || m.date < today) continue;
    const tm = /^(\d{1,2}):(\d{1,2})$/.exec(m.time || '');
    const mtime = tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 ? at(m.date, m.time) : null;
    const who = `${c.name} ${pos(c)} (${co(c)})`;
    const when = `${m.date} ${m.time || '(시간 미정)'}`;
    const link: NoticeLink = { to: 'briefing', customerId: m.customerId, interactionId: m.id };
    if (conf.meetDaybefore) {
      const fire = at(addDays(m.date, -1), hm);
      if (fire <= nowS && (mtime === null || nowS < mtime) && today < addDays(m.date, 1)) {
        out.push({
          key: `meet1d:${m.id}:${m.date}`, kind: 'meeting', refId: m.id, customerId: m.customerId, eventDate: m.date, fireAt: fire,
          title: `[${m.date === today ? '오늘' : '내일'} 미팅] ${m.time || ''} ${who}`.replace(/ {2}/g, ' '),
          body: `${when} · ${m.title} · 미팅 브리핑을 확인하세요`, link,
        });
      }
    }
    if (conf.meetHourbefore && mtime) {
      const hourBefore = hourEarlier(mtime);
      if (hourBefore <= nowS && nowS < mtime) {
        out.push({
          key: `meet1h:${m.id}:${m.date}:${m.time}`, kind: 'meeting', refId: m.id, customerId: m.customerId, eventDate: m.date, fireAt: hourBefore,
          title: `[1시간 후 미팅] ${m.time} ${who}`, body: `${m.title} · 미팅 브리핑을 확인하세요`, link,
        });
      }
    }
  }

  // 5) 미팅 종료 1시간 뒤 맞춤형 질문
  if (conf.fuEnable) {
    for (const m of pending(a, now, conf)) {
      out.push({
        key: `fu:${m.id}:${m.date}`, kind: 'followup', refId: m.id, customerId: m.customerId, eventDate: m.date, fireAt: m.fireAt,
        title: `[미팅 후 질문] ${m.name} ${pos(m)} (${co(m)})`,
        body: `${m.date} ${m.title} · 짧은 질문 몇 개로 고객정보를 채워 보세요`,
        link: { to: 'followup', customerId: m.customerId, interactionId: m.id },
      });
    }
  }
  return out;
}

function hourEarlier(stampStr: string): string {
  // 'YYYY-MM-DD HH:MM:SS' 에서 1시간 전(날짜가 바뀔 수 있다)
  const [d, t] = stampStr.split(' ');
  const [h, m, s] = t.split(':').map(Number);
  const total = h * 60 + m - 60;
  if (total >= 0) return `${d} ${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  const total2 = total + 1440;
  return `${addDays(d, -1)} ${String(Math.floor(total2 / 60)).padStart(2, '0')}:${String(total2 % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 알림을 누가 어느 범위까지 보는가. userId가 있으면 읽음 표시를 그 사람 몫으로 따로 센다(같은 브라우저를 여러 사람이 써도 서로의 읽음에 영향을 주지 않는다).
 * ids는 볼 고객 ID(없으면 전체). 범위는 scope.ts의 customerIdsInScope로 만든다.
 */
export interface NoticeView {
  userId?: string;
  ids?: ReadonlySet<string> | null;
}
/** 읽음 키: 사용자별로 「U1:req:RQ-001:…」. userId가 없으면 키 그대로(옛 방식) */
export const readKeyOf = (key: string, userId?: string) => (userId ? `${userId}:${key}` : key);

/** 알림 목록(제목 300자·본문 500자까지, 읽음 표시 반영). 가까운 일정 순 */
export function computeNotices(a: AssistantData, now: Date, v: NoticeView = {}): Notice[] {
  const read = new Set(a.noticeRead);
  const list = candidates(a, now, v.ids).map((c) => ({ ...c, title: c.title.trim().slice(0, 300), body: c.body.slice(0, 500), read: read.has(readKeyOf(c.key, v.userId)) }));
  return sortStable(list, (x, y) => (x.eventDate < y.eventDate ? -1 : x.eventDate > y.eventDate ? 1 : 0));
}

export const unreadNotices = (a: AssistantData, now: Date, v: NoticeView = {}) => computeNotices(a, now, v).filter((n) => !n.read);
/** 메뉴에 붙일 숫자 */
export const unreadCount = (a: AssistantData, now: Date, v: NoticeView = {}) => unreadNotices(a, now, v).length;

/** 읽음 표시에 남기는 키의 상한(후보에서 빠진 키는 정리하지만 안전장치로 한 번 더) */
export const NOTICE_READ_LIMIT = 500;

function prune(a: AssistantData, now: Date) {
  const live = new Set(candidates(a, now).map((c) => c.key));
  // 사용자별 키(「U1:…」)는 앞 사용자 표시를 뗀 키가, 옛 키는 그대로가 아직 알림 후보일 때만 남긴다
  const keep = (e: string) => live.has(e) || (e.includes(':') && live.has(e.slice(e.indexOf(':') + 1)));
  a.noticeRead = a.noticeRead.filter(keep).slice(-NOTICE_READ_LIMIT);
}

/** 알림 하나를 읽음으로(userId가 있으면 그 사람 몫). 더 이상 후보가 아닌 옛 키는 함께 정리한다 */
export function markNoticeRead(a: AssistantData, key: string, now: Date, userId?: string): void {
  const k = readKeyOf(key, userId);
  if (!a.noticeRead.includes(k)) a.noticeRead.push(k);
  prune(a, now);
}
/** 지금 보이는(범위 안) 알림을 모두 읽음으로 */
export function markAllNoticesRead(a: AssistantData, now: Date, v: NoticeView = {}): void {
  for (const c of candidates(a, now, v.ids)) {
    const k = readKeyOf(c.key, v.userId);
    if (!a.noticeRead.includes(k)) a.noticeRead.push(k);
  }
  prune(a, now);
}

// ───────────── 설정 ─────────────

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 설정을 검사해 합친 값을 돌려준다(원본 api_notify_settings_put의 검사). 저장은 호출한 쪽이 a.conf에 한다 */
export function validateConf(cur: AssistantConf, patch: Partial<Record<keyof AssistantConf, unknown>>): { conf: AssistantConf } | { error: string } {
  const next: AssistantConf = { ...cur };
  if ('notifyTime' in patch) {
    const v = String(patch.notifyTime ?? '').trim();
    if (!HM.test(v)) return { error: '알림 시각 형식이 올바르지 않습니다. (예: 09:00)' };
    next.notifyTime = v;
  }
  if ('fuNotime' in patch) {
    const v = String(patch.fuNotime ?? '').trim();
    if (!HM.test(v)) return { error: '시간이 없는 미팅의 질문 시각 형식이 올바르지 않습니다. (예: 18:00)' };
    next.fuNotime = v;
  }
  if ('fuDuration' in patch) {
    const v = String(patch.fuDuration ?? '').trim();
    if (!/^\d+$/.test(v) || Number(v) < 10 || Number(v) > 480) return { error: '기본 미팅 소요시간은 10~480분 사이로 입력해 주세요.' };
    next.fuDuration = Number(v);
  }
  for (const k of ['reqRemind', 'bdayRemind'] as const) {
    if (!(k in patch)) continue;
    const days = parseDays(String(patch[k] ?? ''));
    if (!days.length) return { error: '알림 시점을 하나 이상 입력해 주세요. (예: 7,2,0)' };
    next[k] = days.join(',');
  }
  for (const k of ['meetDaybefore', 'meetHourbefore', 'fuEnable'] as const) {
    if (k in patch) next[k] = patch[k] === true || patch[k] === '1' || patch[k] === 1 || patch[k] === 'true';
  }
  return { conf: next };
}
