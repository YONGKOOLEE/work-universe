// 미팅 후 맞춤형 질문 — 미팅이 끝나고 1시간 뒤, 그 고객 정보 중 비어 있거나 오래된 항목만 골라 짧은 질문(최대 5개)을 만들고
// 답을 고객정보·요청사항·미팅 기록 「반영안」으로 바꾼다. 모두 규칙 기반이며 외부로 전송하지 않는다.
// 원본: ClientMemory app/followup.py + server.py의 api_followup_*.
// 원칙(그대로 가져옴): 답하지 않은 항목은 저장하지 않는다 · 「언급 없음」은 30일 동안 다시 묻지 않는다 · 먹은 음식은 선호로 저장하지 않는다 ·
//   생년월일·가족·건강 등 사적 질문은 만들지 않는다(CR-25 2.3-6: 「가족·생활」 선택지를 뺐다) · 사용자가 체크한 반영안만 저장한다.
import { addDays, addMinutes, mdLabel, stamp, ymd } from './dates';
import { appendToList } from './lists';
import { addRequest, affectedDates, applyActivityDates, dateError, fieldValueError, isErr, recomputeActivityDates, updateCustomer, updateRequest, type Err } from './model';
import type { AssistantConf, AssistantData, CustomerFieldKey, FollowupState, Interaction } from './types';
import { FIELD_KEYS, FIELD_LABELS } from './types';

export const MAX_QUESTIONS = 5;
/** 미팅 후 며칠까지 질문 알림을 유지할지 */
export const LOOKBACK_DAYS = 3;
/** 「언급 없음」으로 답한 질문은 이 기간 동안 다시 묻지 않음 */
export const NO_REASK_DAYS = 30;
/** 이 일수보다 오래된 항목은 「여전히 맞나요?」로 다시 확인 */
export const STALE_DAYS: Record<string, number> = { recentInterests: 90, foodLikes: 365, contactPreference: 365 };
export const LIST_FIELDS: CustomerFieldKey[] = ['foodLikes', 'foodDislikes', 'hobbies', 'recentInterests'];

export interface QInput {
  key: string;
  label: string;
  type: 'text' | 'date';
  placeholder: string;
}
export interface QOption {
  value: string;
  label: string;
  inputs: QInput[];
}
export interface Question {
  id: string;
  reason: string;
  text: string;
  options: QOption[];
}
const opt = (value: string, label: string, inputs: QInput[] = []): QOption => ({ value, label, inputs });
const inp = (key: string, label: string, type: 'text' | 'date' = 'text', placeholder = ''): QInput => ({ key, label, type, placeholder });

// ───────────── 질문 시각·대기 목록 ─────────────

const hmOf = (s: string | undefined): [number, number] | null => {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(s ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const pad = (n: number) => String(n).padStart(2, '0');

/** 질문 문구의 「오늘」: 미팅이 오늘이면 「오늘」, 아니면 「10월 29일」(다른 해면 연도도 붙임) */
export function meetingDayWord(meetingDate: string, today: string): string {
  if (meetingDate === today) return '오늘';
  const y = meetingDate.slice(0, 4);
  return (y !== today.slice(0, 4) ? `${y}년 ` : '') + mdLabel(meetingDate);
}

/** 질문 알림 시각 = 미팅 종료 1시간 뒤(종료 시간이 없으면 시작 + 기본 소요시간, 시작 시간도 없으면 지정 시각). 'YYYY-MM-DD HH:MM:SS' */
export function fireTime(m: Pick<Interaction, 'date' | 'time' | 'endTime'>, conf: Pick<AssistantConf, 'fuDuration' | 'fuNotime'>): string {
  const end = hmOf(m.endTime);
  const start = hmOf(m.time);
  if (end) return addMinutes(`${m.date} ${pad(end[0])}:${pad(end[1])}:00`, 60);
  if (start) return addMinutes(`${m.date} ${pad(start[0])}:${pad(start[1])}:00`, (Number(conf.fuDuration) || 60) + 60);
  const nt = hmOf(conf.fuNotime) ?? [18, 0];
  return `${m.date} ${pad(nt[0])}:${pad(nt[1])}:00`;
}

export const getState = (a: AssistantData, interactionId: string): FollowupState | undefined => a.followups.find((f) => f.interactionId === interactionId);

/** 상태 저장(원본 set_state): 답·질문 목록이 비어 있으면 이전 값을 유지한다 */
export function setState(a: AssistantData, interactionId: string, status: FollowupState['status'], now: Date, answers?: FollowupState['answers'], asked?: string[]) {
  const cur = getState(a, interactionId);
  const ts = stamp(now);
  if (cur) {
    cur.status = status;
    if (answers && Object.keys(answers).length) cur.answers = answers;
    if (asked && asked.length) cur.asked = asked;
    cur.updatedAt = ts;
  } else {
    a.followups.push({ interactionId, status, answers: answers ?? {}, asked: asked ?? [], updatedAt: ts });
  }
}

export interface PendingFollowup extends Interaction {
  name: string;
  position: string;
  company: string;
  fireAt: string;
}
/** 질문 시각이 지났고 아직 답하지 않은 최근 미팅(오늘 포함 LOOKBACK_DAYS일) */
export function pending(a: AssistantData, now: Date, conf: AssistantConf = a.conf): PendingFollowup[] {
  const nowS = stamp(now);
  const today = ymd(now);
  const from = addDays(today, -LOOKBACK_DAYS);
  const byId = new Map(a.customers.map((c) => [c.id, c]));
  const rows: PendingFollowup[] = [];
  for (const m of a.interactions) {
    if (m.type !== '미팅' || m.date < from || m.date > today) continue;
    const c = byId.get(m.customerId);
    if (!c) continue;
    const st = getState(a, m.id);
    if (st && st.status !== 'pending') continue;
    const ft = fireTime(m, conf);
    if (ft <= nowS) rows.push({ ...m, name: c.name, position: c.position, company: c.company, fireAt: ft });
  }
  // 최근 미팅 먼저(date DESC, time DESC)
  return rows.map((x, i) => ({ x, i })).sort((p, q) => (q.x.date < p.x.date ? -1 : q.x.date > p.x.date ? 1 : q.x.time < p.x.time ? -1 : q.x.time > p.x.time ? 1 : q.i - p.i)).map((p) => p.x);
}

// ───────────── 질문 만들기 ─────────────

/** 항목이 마지막으로 바뀐 뒤 지난 일수. 이력이 없으면 null(데모 고객은 등록 이력을 저장하지 않으므로 null → 오래된 정보로 보지 않는다) */
function fieldAgeDays(a: AssistantData, customerId: string, field: string, now: Date): number | null {
  let last = '';
  for (const h of a.changes) if (h.customerId === customerId && h.field === field && h.changedAt > last) last = h.changedAt;
  if (!last) return null;
  const [d, t] = last.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [hh, mi, ss] = (t ?? '00:00:00').split(':').map(Number);
  const nowS = stamp(now);
  const [nd, nt] = nowS.split(' ');
  const [ny, nmo, nda] = nd.split('-').map(Number);
  const [nhh, nmi, nss] = nt.split(':').map(Number);
  return Math.floor((Date.UTC(ny, nmo - 1, nda, nhh, nmi, nss) - Date.UTC(y, mo - 1, da, hh, mi, ss || 0)) / 86400000);
}

/** 최근 30일 안에 「언급 없음/기억 안 남」으로 답한 질문 id(다시 묻지 않음) */
function recentNoInfo(a: AssistantData, customerId: string, now: Date, exceptInteractionId = ''): Set<string> {
  const since = addMinutes(stamp(now), -NO_REASK_DAYS * 1440);
  const mine = new Set(a.interactions.filter((i) => i.customerId === customerId).map((i) => i.id));
  const skip = new Set<string>();
  for (const f of a.followups) {
    // 지금 열어 둔 미팅 자신의 옛 답은 뺀다 — 잘못 누른 「언급 없음」 때문에 같은 미팅을 다시 열었을 때 그 질문이 사라지면 고칠 수 없다
    if (!mine.has(f.interactionId) || f.interactionId === exceptInteractionId || f.status !== 'done' || f.updatedAt < since) continue;
    for (const [qid, ans] of Object.entries(f.answers ?? {})) if (ans?.value === 'none' || ans?.value === 'unknown') skip.add(qid);
  }
  return skip;
}

export interface FollowupBuild {
  meeting: Interaction;
  customer: { id: string; name: string; position: string; company: string; updatedAt: string };
  questions: Question[];
  status: 'pending' | 'done' | 'skipped';
  note: string;
}

/** 미팅 하나에 대한 질문 목록. 첫 두 질문(진행 여부·새 요청)은 항상, 나머지는 비어 있는 항목만 골라 최대 5개 */
export function buildQuestions(a: AssistantData, interactionId: string, now: Date, myName = ''): FollowupBuild | null {
  const m = a.interactions.find((i) => i.id === interactionId);
  if (!m) return null;
  const c = a.customers.find((x) => x.id === m.customerId);
  if (!c) return null;
  const who = `${`${c.name} ${c.position || ''}`.trim()}님`;
  const skip = recentNoInfo(a, c.id, now, interactionId);
  const today = ymd(now);
  const dw = meetingDayWord(m.date, today);
  const qs: Question[] = [];

  qs.push({ id: 'held', reason: '미팅 진행 여부 확인', text: `'${m.title}' 미팅은 예정대로 진행되었나요?`, options: [opt('yes', '예정대로 진행됨'), opt('moved', '다른 날로 연기됨', [inp('new_date', '변경된 날짜', 'date')]), opt('cancel', '취소됨')] });
  qs.push({
    id: 'request',
    reason: '업무상 요청사항 확인',
    text: `${dw} ${who}이 새롭게 요청한 업무가 있었나요?`,
    options: [
      ...['자료 요청', '서비스 개선 요청', '추가 미팅 요청', '문의사항 확인 요청', '기타'].map((v) => opt(v, v, [inp('content', '요청 내용', 'text', '예: CMS 이용현황 자료 전달'), inp('due_date', '처리기한', 'date'), inp('assignee', '담당자 (비워도 됨)', 'text', '예: 담당자 이름을 적으세요')])),
      opt('none', '요청사항 없음'),
    ],
  });

  const extra: Question[] = [];
  if (!(c.foodLikes || c.foodDislikes)) {
    if (!skip.has('food_ate')) extra.push({ id: 'food_ate', reason: '음식 선호 정보 없음', text: `${dw} ${who}과 어떤 음식을 드셨나요?`, options: [...['한식', '중식', '일식', '양식', '기타'].map((v) => opt(v, v)), opt('none', '식사하지 않음')] });
    if (!skip.has('food_pref'))
      extra.push({
        id: 'food_pref',
        reason: '음식 선호 정보 없음',
        text: '고객이 특별히 선호하거나 기피하는 음식이 있었나요?',
        options: [opt('like', '선호 음식이 있었음', [inp('like', '선호 음식', 'text', '예: 한식, 국밥')]), opt('dislike', '기피 음식이 있었음', [inp('dislike', '기피 음식', 'text', '예: 해산물')]), opt('both', '둘 다 있었음', [inp('like', '선호 음식'), inp('dislike', '기피 음식')]), opt('none', '특별한 언급 없음'), opt('unknown', '기억나지 않음')],
      });
  }
  if (!c.recentInterests && !skip.has('interest')) {
    // 「가족·생활」 선택지는 뺐다(가족 등 사적 질문은 만들지 않는다는 원칙 — CR-25 2.3-6)
    extra.push({
      id: 'interest',
      reason: '최근 관심사 정보 없음',
      text: `${dw} 대화에서 고객이 관심을 보인 주제가 있었나요?`,
      options: [...(
        [['취미·여가', '예: 테니스'], ['업무·사업', '예: 출금 재시도 기능'], ['경제·투자', '예: 금리 동향'], ['기타', '']] as const
      ).map(([v, ph]) => opt(v, v, [inp('text', '구체적으로', 'text', ph)])), opt('none', '특별한 언급 없음')],
    });
  }
  if ((!c.nextContactDate || c.nextContactDate < today) && !skip.has('next_contact')) {
    extra.push({ id: 'next_contact', reason: !c.nextContactDate ? '다음 연락 일정 없음' : '예정 연락일 지남', text: '다음 연락이나 미팅 일정이 잡혔나요?', options: [opt('set', '날짜가 정해짐', [inp('date', '날짜', 'date')]), opt('none', '아직 미정')] });
  }
  if (!c.personality && !skip.has('personality')) {
    extra.push({ id: 'personality', reason: '대화 스타일 정보 없음', text: '고객의 대화 스타일은 어땠나요?', options: [...['결론부터 듣는 것을 선호', '자세한 설명을 선호', '친근한 대화를 선호', '격식 있는 대화를 선호'].map((v) => opt(v, v)), opt('etc', '기타', [inp('text', '직접 입력')]), opt('unknown', '잘 모르겠음')] });
  }
  if (!c.contactPreference && !skip.has('contact_pref')) {
    extra.push({ id: 'contact_pref', reason: '선호 연락 방식 정보 없음', text: '고객이 편하다고 한 연락 방식이 있었나요?', options: [...['휴대전화', '사무실 전화', '이메일', '메신저', '문자'].map((v) => opt(v, v)), opt('none', '언급 없음')] });
  }
  if (!(c.department && c.position) && !skip.has('org')) {
    extra.push({ id: 'org', reason: '부서·직책 정보 없음', text: '고객의 부서와 직책을 확인했나요?', options: [opt('set', '확인함', [inp('department', '부서'), inp('position', '직책')]), opt('unknown', '확인 못 함')] });
  }
  for (const [f, label] of [['recentInterests', '최근 관심 주제'], ['foodLikes', '선호 음식'], ['contactPreference', '선호 연락 방식']] as const) {
    const age = fieldAgeDays(a, c.id, f, now);
    if (c[f] && age !== null && age >= STALE_DAYS[f] && !skip.has(`stale_${f}`)) {
      extra.push({ id: `stale_${f}`, reason: `${age}일 전 정보 — 확인 필요`, text: `기록된 ${label} '${c[f]}'이(가) 여전히 맞나요?`, options: [opt('same', '여전히 맞음'), opt('changed', '바뀌었음', [inp('text', `새 ${label}`)]), opt('unknown', '확인 못 함')] });
    }
  }
  qs.push(...extra.slice(0, MAX_QUESTIONS - qs.length));
  const st = getState(a, interactionId);
  return {
    meeting: m,
    customer: { id: c.id, name: c.name, position: c.position, company: c.company, updatedAt: c.updatedAt },
    questions: qs,
    status: st?.status ?? 'pending',
    note: '이 고객 정보 중 비어 있거나 오래된 항목만 골라 만든 질문입니다. 답하지 않은 항목은 저장되지 않습니다.',
  };
}

// ───────────── 답변 → 반영안 ─────────────

export type Answers = Record<string, Record<string, string>>;
export type ProposalKind = 'field' | 'request' | 'request_due' | 'meeting_held' | 'meeting_note' | 'meeting_move' | 'meeting_cancel';
/** 답은 했지만 이대로는 저장되지 않는 경우의 안내. blocking이면 확인 단계로 넘어갈 수 없다 */
export interface FollowupProblem {
  qid: string;
  text: string;
  blocking: boolean;
}
export const NEED_TEXT = '내용을 적어야 저장됩니다.';
export const NEED_DATE = '날짜를 입력해야 저장됩니다.';
export const NEED_NEW_DATE = '바뀐 날짜를 입력해 주세요. 날짜가 없으면 다음 단계로 넘어갈 수 없습니다.';

export interface FollowupProposal {
  kind: ProposalKind;
  label: string;
  old: string;
  new: string;
  field?: CustomerFieldKey;
  value?: string;
  mode?: 'append' | 'replace';
  dueDate?: string;
  assignee?: string;
}

/** 답변을 반영안 목록으로(아직 저장하지 않는다). 물어보지 않은 질문의 답은 무시한다 */
export function proposals(a: AssistantData, interactionId: string, answers: Answers, now: Date, myName = ''): { proposals: FollowupProposal[]; info: FollowupBuild; problems: FollowupProblem[] } | null {
  const info = buildQuestions(a, interactionId, now, myName);
  if (!info) return null;
  const m = info.meeting;
  const c = a.customers.find((x) => x.id === m.customerId)!;
  const asked = new Set(info.questions.map((q) => q.id));
  const out: FollowupProposal[] = [];
  const notes: string[] = [];
  const problems: FollowupProblem[] = [];
  const need = (qid: string, text = NEED_TEXT, blocking = false) => problems.push({ qid, text, blocking });
  const blank = (v: string | undefined) => !(v ?? '').trim();
  const ans = (qid: string): Record<string, string> | null => {
    const v = answers?.[qid];
    return v && asked.has(qid) && v.value ? v : null;
  };
  const field = (f: CustomerFieldKey, value: string | undefined, mode?: 'append' | 'replace') => {
    const v = (value ?? '').trim();
    if (!v) return;
    const old = c[f] || '';
    const md = mode ?? (LIST_FIELDS.includes(f) && old ? 'append' : 'replace');
    // 이어 붙이기는 「A, B」 조각 단위로 이미 있는지 본다(있으면 반영안을 만들지 않고, 없으면 기존 값 뒤에 더한다)
    const nw = md === 'append' && old ? appendToList(old, v) : v;
    if (nw === null || nw === old) return;
    out.push({ kind: 'field', field: f, label: FIELD_LABELS[f], old, new: nw, value: v, mode: md });
  };

  const held = ans('held');
  // 날짜 없는 「연기됨」을 취소로 바꾸지 않는다: 날짜를 입력할 때까지 확인 단계로 넘어가지 않는다. 다른 질문의 답은 그대로 살려 둔다(안내도 계속 계산)
  const movedNoDate = !!held && held.value === 'moved' && blank(held.new_date);
  if (movedNoDate) need('held', NEED_NEW_DATE, true);
  if (held && !movedNoDate && (held.value === 'moved' || held.value === 'cancel')) {
    if (held.value === 'moved') out.push({ kind: 'meeting_move', label: '미팅 날짜 변경', old: m.date, new: held.new_date.trim() });
    else out.push({ kind: 'meeting_cancel', label: '미팅 취소 처리', old: m.title, new: `[취소] ${m.title} (유형: 메모로 변경)` });
    return { proposals: out, info, problems };
  }
  if (held && held.value === 'yes' && (c.lastMeetingDate || '') < m.date) out.push({ kind: 'meeting_held', label: '최근 미팅일·연락일 갱신', old: c.lastMeetingDate || '(없음)', new: m.date });

  const r = ans('request');
  if (r && r.value !== 'none') {
    const content = (r.content || '').trim();
    if (!content) need('request');
    // 같은 미팅에서 이미 저장한 같은 요청은 다시 만들지 않는다(다시 답해도 중복되지 않게)
    else {
      const same = a.requests.find((x) => x.customerId === c.id && x.interactionId === interactionId && x.content === content);
      const due = (r.due_date || '').trim();
      if (!same) out.push({ kind: 'request', label: `요청사항 등록 (${r.value})`, old: '', new: content, dueDate: r.due_date || '', assignee: (r.assignee || '').trim() });
      // 같은 내용에 새 기한으로 다시 답하면 기한 변경 반영안을 만든다. 기한이 같거나 없으면 이미 등록됐다고 알린다
      else if (due && due !== same.dueDate) out.push({ kind: 'request_due', label: '요청사항 기한 변경', old: same.dueDate || '(없음)', new: due, value: same.id });
      else need('request', '이미 등록된 요청입니다. 새로 만들지 않습니다.');
    }
  }
  const fa = ans('food_ate');
  if (fa) notes.push(`식사: ${fa.value === 'none' ? '식사하지 않음' : fa.value}`); // 먹은 음식은 선호 음식으로 저장하지 않고 미팅 메모에만
  const fp = ans('food_pref');
  if (fp && ['like', 'dislike', 'both'].includes(fp.value)) {
    if ((fp.value === 'like' || fp.value === 'both') && !blank(fp.like)) field('foodLikes', fp.like);
    if ((fp.value === 'dislike' || fp.value === 'both') && !blank(fp.dislike)) field('foodDislikes', fp.dislike);
    const missing = (fp.value === 'like' && blank(fp.like)) || (fp.value === 'dislike' && blank(fp.dislike)) || (fp.value === 'both' && (blank(fp.like) || blank(fp.dislike)));
    if (missing) need('food_pref');
  }
  const it = ans('interest');
  if (it && it.value !== 'none') {
    if (blank(it.text)) need('interest');
    else {
      field(it.value === '취미·여가' ? 'hobbies' : 'recentInterests', it.text);
      notes.push(`관심 주제(${it.value}): ${it.text.trim()}`);
    }
  }
  const nc = ans('next_contact');
  if (nc && nc.value === 'set') {
    if (blank(nc.date)) need('next_contact', NEED_DATE);
    else field('nextContactDate', nc.date, 'replace');
  }
  const pe = ans('personality');
  if (pe && pe.value === 'etc' && blank(pe.text)) need('personality');
  if (pe && pe.value !== 'unknown') field('personality', pe.value === 'etc' ? pe.text : pe.value, 'replace');
  const cp = ans('contact_pref');
  if (cp && cp.value !== 'none') field('contactPreference', cp.value, 'replace');
  const og = ans('org');
  if (og && og.value === 'set') {
    if (blank(og.department) && blank(og.position)) need('org');
    if (!c.department) field('department', og.department, 'replace');
    if (!c.position) field('position', og.position, 'replace');
  }
  for (const f of ['recentInterests', 'foodLikes', 'contactPreference'] as const) {
    const st = ans(`stale_${f}`);
    if (st && st.value === 'changed') {
      if (blank(st.text)) need(`stale_${f}`);
      else field(f, st.text, 'replace');
    }
  }
  if (notes.length) {
    // 메모 날짜는 미팅 날짜. 같은 메모가 이미 미팅 기록에 있으면 다시 더하지 않는다
    const note = `[미팅 후 확인 ${m.date}] ${notes.join(' / ')}`;
    if (!(m.details || '').includes(note)) out.push({ kind: 'meeting_note', label: '미팅 기록에 메모 추가', old: '', new: note });
  }
  return { proposals: out, info, problems };
}

// ───────────── 승인 반영 ─────────────

export interface FollowupChoice {
  /** 반영안 목록에서의 순서 */
  idx: number;
  include: boolean;
  /** 사용자가 고친 값 */
  new?: string;
  dueDate?: string;
  assignee?: string;
}

/** 오늘 이전까지 진행된 미팅에만 질문에 답할 수 있다 */
export function meetingError(a: AssistantData, interactionId: string, now: Date): string {
  const m = a.interactions.find((i) => i.id === interactionId);
  if (!m) return '미팅 기록을 찾을 수 없습니다.';
  if (m.type !== '미팅') return '미팅 기록에만 질문을 만들 수 있습니다.';
  if (m.date > ymd(now)) return '아직 진행되지 않은 미팅입니다. 미팅이 끝난 뒤 질문에 답할 수 있습니다.';
  return '';
}

const PROPOSAL_KINDS: ProposalKind[] = ['field', 'request', 'request_due', 'meeting_held', 'meeting_note', 'meeting_move', 'meeting_cancel'];

/**
 * 체크한 반영안만 저장한다. 고객 항목은 변경 이력(출처 「미팅 후 질문」)으로 남고, 미팅이 연기되면 질문 상태를 지워 새 날짜에 다시 묻는다.
 * given(확인 화면이 보여 준 반영안)을 주면 저장 때 다시 만들지 않고 그대로 쓴다 → 확인과 저장 사이에 고객 정보가 바뀌어도 선택 번호(idx)가 어긋나지 않는다.
 * 같은 요청·같은 메모는 이미 저장돼 있으면 다시 더하지 않는다(다시 답해도 중복되지 않음).
 */
export function applyFollowup(a: AssistantData, interactionId: string, answers: Answers, choices: FollowupChoice[], now: Date, myName = '', given?: FollowupProposal[]): { applied: number; customerId: string; moved: boolean; conflicts?: string[] } | Err {
  const me = meetingError(a, interactionId, now);
  if (me) return { error: me };
  const r = proposals(a, interactionId, answers, now, myName)!;
  const blocking = r.problems.find((p) => p.blocking);
  if (blocking) return { error: blocking.text };
  let list = r.proposals;
  if (given) {
    // 화면에서 넘어온 반영안은 모양을 검사해 쓴다(알 수 없는 종류·항목은 거부)
    for (const p of given) {
      if (!p || !PROPOSAL_KINDS.includes(p.kind)) return { error: '반영안 형식이 올바르지 않습니다. 화면을 새로 열어 다시 시도해 주세요.' };
      if (p.kind === 'field' && !(p.field && FIELD_KEYS.includes(p.field))) return { error: '반영안 항목이 올바르지 않습니다. 화면을 새로 열어 다시 시도해 주세요.' };
    }
    list = given;
  }
  const m = a.interactions.find((i) => i.id === interactionId)!;
  const chosen = new Map(choices.filter((x) => x.include).map((x) => [x.idx, x]));
  const cid = m.customerId;
  const note = `미팅 후 질문 (${m.date} ${m.title})`;
  let applied = 0;
  let moved = false;
  const conflicts: string[] = [];
  // 저장 도중 오류가 나면 아무것도 바꾸지 않도록 먼저 모든 값을 검사한다
  for (const [idx, ch] of chosen) {
    const p = list[idx];
    if (!p) continue;
    const val = String(ch.new ?? p.new ?? '').trim();
    if (p.kind === 'field' && p.field && val) {
      if (p.field === 'nextContactDate' || p.field === 'birthDate') {
        const e = dateError(val, p.label);
        if (e) return { error: e, field: p.field };
      }
      const e = fieldValueError(p.field, val, now);
      if (e) return { error: e, field: p.field };
    }
    if (p.kind === 'request_due') {
      const e = dateError(val, '처리기한', true);
      if (e) return { error: e };
    }
    if (p.kind === 'request') {
      const e = dateError(ch.dueDate ?? p.dueDate ?? '', '처리기한');
      if (e) return { error: e };
    }
    if (p.kind === 'meeting_move') {
      const e = dateError(val, '변경된 날짜', true);
      if (e) return { error: e };
    }
  }
  list.forEach((p, idx) => {
    const ch = chosen.get(idx);
    if (!ch) return;
    const val = String(ch.new ?? p.new ?? '').trim();
    if (p.kind === 'field') {
      if (!val || !p.field) return;
      // 반영안을 만든 뒤 이 항목이 다른 곳에서 바뀌었으면 덮어쓰지 않는다(다른 항목은 저장)
      if ((a.customers.find((x) => x.id === cid)?.[p.field] || '') !== p.old) {
        conflicts.push(`${p.label}: 확인 후 값이 바뀌었습니다. 저장하지 않았습니다.`);
        return;
      }
      const u = updateCustomer(a, cid, { [p.field]: val }, { now, source: 'followup', note });
      if (isErr(u)) return;
    } else if (p.kind === 'request') {
      if (!val) return;
      if (a.requests.some((x) => x.customerId === cid && x.interactionId === interactionId && x.content === val)) return;
      addRequest(a, cid, { content: val, receivedDate: m.date, dueDate: ch.dueDate ?? p.dueDate ?? '', assignee: (ch.assignee ?? p.assignee ?? '').trim(), interactionId }, { now, source: 'followup' });
    } else if (p.kind === 'request_due') {
      const rq = a.requests.find((x) => x.id === p.value && x.customerId === cid);
      if (!rq || !val) return;
      updateRequest(a, rq.id, { dueDate: val }, now);
    } else if (p.kind === 'meeting_held') {
      applyActivityDates(a, cid, '미팅', m.date, now);
    } else if (p.kind === 'meeting_note') {
      if (!val || (m.details || '').includes(val)) return;
      m.details = (m.details ? `${m.details}\n\n` : '') + val;
    } else if (p.kind === 'meeting_move') {
      const before = m.date;
      m.date = val;
      a.followups = a.followups.filter((f) => f.interactionId !== interactionId);
      recomputeActivityDates(a, cid, now, affectedDates([{ type: '미팅', date: before }, { type: '미팅', date: val }]));
      moved = true;
    } else if (p.kind === 'meeting_cancel') {
      m.type = '메모';
      m.title = `[취소] ${m.title}`;
      recomputeActivityDates(a, cid, now, affectedDates([{ type: '미팅', date: m.date }]));
    }
    applied += 1;
  });
  if (!moved) setState(a, interactionId, 'done', now, answers, r.info.questions.map((q) => q.id));
  return { applied, customerId: cid, moved, ...(conflicts.length ? { conflicts } : {}) };
}

/** 이 미팅의 질문을 건너뛴다 */
export function skipFollowup(a: AssistantData, interactionId: string, now: Date): { ok: true } | Err {
  const me = meetingError(a, interactionId, now);
  if (me) return { error: me };
  setState(a, interactionId, 'skipped', now);
  return { ok: true };
}
