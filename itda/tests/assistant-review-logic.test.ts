// 검토(2026-10-30)로 나온 데이터·로직 문제의 회귀 시험 — 항목 번호는 검토 목록 번호. 가상 데이터만.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { migrate } from '../src/lib/migrate';
import { parseBackup } from '../src/lib/store';
import { applyMerge, newCustomers, planMerge, previewCounts, replaceCustomerInfo, replaceKeepingOtherMemos, sameCustomer } from '../src/lib/mergeImport';
import { ownedCustomerCount, personUsages, setPersonStatus } from '../src/lib/people';
import type { AppState } from '../src/lib/types';
import { createAssistantSeed } from '../src/assistant/seed';
import { appendToList, listHas, listParts } from '../src/assistant/lists';
import {
  MAX_DETAILS_CHARS, MAX_TEXT_CHARS, addInteraction, addRequest, createCustomer, deleteInteraction, emptyAssistant, fieldValueError, isErr, restoreChange, updateCustomer, updateInteraction, updateRequest,
} from '../src/assistant/model';
import { applyDraft, enrichDraft, maskText, prepareText, verifyItems, verifyQuote, type Draft, type DraftItem, type EnrichedDraft } from '../src/assistant/claude';
import { sampleDraft, SAMPLE_FILE } from '../src/assistant/sample';
import { applyFollowup, buildQuestions, meetingDayWord, proposals } from '../src/assistant/followup';
import { computeNotices, markAllNoticesRead, markNoticeRead, unreadCount } from '../src/assistant/notices';
import { customerIdsInScope, effectiveScope, filterAssistant, scopeChoices } from '../src/assistant/scope';
import { labelChange } from '../src/assistant/queries';
import { restoreDemoMessage, restoreDemoReport, setCustomerOwner, OWNER_FIELD } from '../src/assistant/ui/logic';
import { buildToday } from '../src/assistant/today';
import type { AssistantData } from '../src/assistant/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0); // 2026-10-30 10:00
const seedA = () => createAssistantSeed(NOW, 'U1');
const cust = (a: AssistantData, name: string) => a.customers.find((c) => c.name === name)!;

/** 승인 화면용 초안 한 건짜리를 직접 만든다(근거 대조는 빼고) */
function draftOf(a: AssistantData, name: string, items: Partial<DraftItem>[], over: Partial<Draft> = {}): Draft {
  return {
    kind: 'ai', customerId: cust(a, name).id, filename: '', original: '', sentText: '', createdAt: '2026-10-30', title: '시험 분석', interactionType: '통화', interactionDate: '2026-10-30', summary: '', speakerNote: '',
    items: items.map((i) => ({ kind: 'profile', evidence: '근거 문장 열두 글자 이상입니다', speaker: 'customer', confidence: 'high', isSpeculation: false, quoteVerified: true, ...i }) as DraftItem),
    ...over,
  };
}

// ───────────── 1. 목록 항목 「기존 값에 추가」 ─────────────
describe('검토 1: 목록 항목은 조각 단위로 이미 있는지 보고 덮어쓰지 않는다', () => {
  it('lists.ts: 조각 단위 포함 판정과 이어 붙이기', () => {
    expect(listParts('한식 위주, 파스타 / 국밥·냉면')).toEqual(['한식 위주', '파스타', '국밥', '냉면']);
    expect(listHas('한식 위주, 파스타', '한식')).toBe(false); // 글 일부가 아니라 조각 단위
    expect(listHas('골프, 등산', '골프')).toBe(true);
    expect(listHas('골프, 등산', '골프, 등산')).toBe(true);
    expect(listHas('골프, 등산', '골프, 테니스')).toBe(false);
    expect(listHas('', '골프')).toBe(false);
    expect(appendToList('한식 위주, 파스타', '한식')).toBe('한식 위주, 파스타, 한식');
    expect(appendToList('골프, 등산', '골프')).toBeNull();
    expect(appendToList('골프, 등산', '골프, 테니스')).toBe('골프, 등산, 테니스');
    expect(appendToList('', '골프')).toBe('골프');
    expect(appendToList('골프', '  ')).toBeNull();
  });
  it('대화 분석 승인(append): 이미 있는 값이면 저장하지 않고(기존 값 유지·변경 이력 없음·반영 건수 0), 없으면 이어 붙인다', () => {
    const a = seedA();
    const c = cust(a, '김도현');
    c.foodLikes = '한식 위주, 파스타';
    expect(c.hobbies).toBe('골프, 등산');
    const d = draftOf(a, '김도현', [
      { field: 'foodLikes', fieldLabel: '선호 음식', value: '파스타' }, // 이미 있음
      { field: 'hobbies', fieldLabel: '취미·관심사', value: '골프' }, // 이미 있음
      { field: 'recentInterests', fieldLabel: '최근 관심 주제', value: '출금 재시도' }, // 새 값
    ]);
    const before = JSON.stringify(a.changes);
    const r = applyDraft(a, d, d.items.map((_, idx) => ({ idx, include: true, mode: 'append' as const })), {}, NOW);
    if (isErr(r)) throw new Error(r.error);
    expect(cust(a, '김도현').foodLikes).toBe('한식 위주, 파스타'); // 이전: 「파스타」 하나로 덮어썼다
    expect(cust(a, '김도현').hobbies).toBe('골프, 등산'); // 이전: 「골프」 하나로 덮어썼다
    expect(cust(a, '김도현').recentInterests).toBe('CMS 운영시간 확대, 출금 재시도');
    expect(r.applied.profile).toBe(1);
    expect(a.changes.filter((h) => h.source === 'ai').map((h) => h.field)).toEqual(['recentInterests']); // 분석 승인으로 생긴 항목 변경은 이것뿐
    expect(before).toBe('[]');
  });
  it('대화 분석 승인(append): 「한식」은 「한식 위주」의 조각이 아니므로 더한다', () => {
    const a = seedA();
    cust(a, '김도현').foodLikes = '한식 위주, 파스타';
    const d = draftOf(a, '김도현', [{ field: 'foodLikes', fieldLabel: '선호 음식', value: '한식' }]);
    applyDraft(a, d, [{ idx: 0, include: true, mode: 'append' }], {}, NOW);
    expect(cust(a, '김도현').foodLikes).toBe('한식 위주, 파스타, 한식');
  });
  it('승인 화면(enrichDraft): 이미 있는 값은 「같음」·기본 해제, 조각이 다르면 「충돌」·이어 붙이기', () => {
    const a = seedA();
    cust(a, '김도현').foodLikes = '한식 위주, 파스타';
    const d = draftOf(a, '김도현', [
      { field: 'foodLikes', fieldLabel: '선호 음식', value: '파스타' },
      { field: 'hobbies', fieldLabel: '취미·관심사', value: '등산' },
      { field: 'recentInterests', fieldLabel: '최근 관심 주제', value: '새 주제' },
    ]);
    const e = enrichDraft(a, d) as EnrichedDraft;
    expect(e.items.map((i) => [i.status, i.include, i.mode])).toEqual([['same', false, 'append'], ['same', false, 'append'], ['conflict', true, 'append']]);
  });
  it('미팅 후 질문: 이미 있는 값이면 반영안을 만들지 않고, 없으면 기존 값 뒤에 이어 붙인다', () => {
    const a = seedA();
    const c = cust(a, '김도현');
    const m = a.interactions.find((i) => i.customerId === c.id && i.date === '2026-10-17')!;
    c.hobbies = '골프, 등산';
    const asked = new Set(buildQuestions(a, m.id, NOW)!.questions.map((q) => q.id));
    // 김도현은 취미·관심 질문(interest)이 나오지 않을 수 있어 질문을 직접 고른다: 음식 선호 질문이 나오도록 비운다
    c.foodLikes = '';
    c.foodDislikes = '';
    expect(asked.size).toBeGreaterThan(0);
    c.foodLikes = '한식 위주, 파스타';
    c.recentInterests = '';
    const qs = buildQuestions(a, m.id, NOW)!.questions.map((q) => q.id);
    expect(qs).toContain('interest');
    // 취미·여가 → hobbies: 「골프」는 이미 조각으로 있으므로 반영안이 없고(메모만), 「테니스」는 이어 붙는다
    const same = proposals(a, m.id, { interest: { value: '취미·여가', text: '골프' } }, NOW)!;
    expect(same.proposals.filter((p) => p.kind === 'field')).toEqual([]);
    const more = proposals(a, m.id, { interest: { value: '취미·여가', text: '테니스' } }, NOW)!;
    expect(more.proposals.filter((p) => p.kind === 'field').map((p) => [p.field, p.old, p.new, p.mode])).toEqual([['hobbies', '골프, 등산', '골프, 등산, 테니스', 'append']]);
  });
});

// ───────────── 2·3·4. 불러오기 ─────────────
describe('검토 2: 바꿔 불러오기에서 파일에 AI 비서 칸이 없으면 지금 고객을 유지한다', () => {
  const base = () => JSON.parse(JSON.stringify(createSeed('linked', NOW))) as AppState;
  it('parseBackup(seedAssistant:false)는 칸이 없으면 없는 채로 둔다(기본은 처음 열기라 채운다)', () => {
    const f = base();
    delete f.assistant;
    expect(parseBackup(JSON.stringify(f), { seedAssistant: false }).assistant).toBeUndefined();
    expect(parseBackup(JSON.stringify(f)).assistant!.customers.length).toBe(18); // 기존 동작(처음 열기·제출본)
    expect(migrate(JSON.parse(JSON.stringify(f)), NOW, { seedAssistant: false }).assistant).toBeUndefined();
  });
  it('replaceKeepingOtherMemos: 파일에 칸이 없으면 지금 고객·활동이 그대로 남고, 있으면 파일 것으로 바뀐다', () => {
    const cur = base();
    createCustomer(cur.assistant!, { name: '내 고객', company: '시험(가상)' }, { now: NOW, ownerId: 'U1' });
    const n = cur.assistant!.customers.length;
    const file = base();
    delete file.assistant;
    const out = replaceKeepingOtherMemos(cur, parseBackup(JSON.stringify(file), { seedAssistant: false }));
    expect(out.assistant!.customers.length).toBe(n);
    expect(out.assistant!.customers.some((c) => c.name === '내 고객')).toBe(true);
    // 파일에 칸이 있으면 파일 것
    const file2 = base();
    file2.assistant = emptyAssistant();
    expect(replaceKeepingOtherMemos(cur, parseBackup(JSON.stringify(file2), { seedAssistant: false })).assistant!.customers.length).toBe(0);
  });
  it('확인 창용 고객 수(지금 → 파일): 파일에 칸이 없으면 null, 담당자가 파일에 없는 고객은 옮길 수로 센다', () => {
    const cur = base();
    const file = base();
    delete file.assistant;
    const f = parseBackup(JSON.stringify(file), { seedAssistant: false });
    expect(replaceCustomerInfo(cur, f)).toEqual({ now: 18, file: null, moved: 0 });
    const f2 = parseBackup(JSON.stringify(base()), { seedAssistant: false });
    f2.assistant!.customers.length = 5;
    expect(replaceCustomerInfo(cur, f2)).toEqual({ now: 18, file: 5, moved: 0 });
    // 담당자가 파일 사람 목록에 없으면 지금 사용자 담당으로 옮긴다
    cur.assistant!.customers[0].ownerId = 'U-없는사람';
    expect(replaceCustomerInfo(cur, f).moved).toBe(1);
    const out = replaceKeepingOtherMemos(cur, f);
    expect(out.assistant!.customers[0].ownerId).toBe(f.currentUserId);
    expect(cur.assistant!.customers[0].ownerId).toBe('U-없는사람'); // 원본은 건드리지 않는다
  });
});

describe('검토 3·4: 합쳐 불러오기', () => {
  const base = () => JSON.parse(JSON.stringify(createSeed('linked', NOW))) as AppState;
  it('3: 들어오는 가상(isDemo) 고객은 더하지 않는다(지운 가상 고객 부활 금지). 파일에 칸이 없으면 합칠 고객이 없다', () => {
    const cur = base();
    cur.assistant!.customers = [];
    cur.assistant!.interactions = [];
    cur.assistant!.requests = [];
    const inc = base(); // 가상 고객 18명
    expect(newCustomers(cur.assistant, inc.assistant)).toEqual([]);
    expect(planMerge(cur, inc).counts.customers).toBe(0);
    expect(applyMerge(cur, inc).state.assistant!.customers.length).toBe(0);
    // 가상이 아닌 고객은 더한다
    const real = createCustomer(inc.assistant!, { name: '실제처럼 등록한 고객', company: '시험(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    expect(newCustomers(cur.assistant, inc.assistant).map((c) => c.id)).toEqual([real.id]);
    // 파일에 칸이 없다(seed 없이 연 경우)
    const f = base();
    delete f.assistant;
    const parsed = parseBackup(JSON.stringify(f), { seedAssistant: false });
    expect(newCustomers(cur.assistant, parsed.assistant)).toEqual([]);
    expect(previewCounts(cur, parsed, planMerge(cur, parsed), {}).customers).toBe(0);
  });
  it('4: 소속·휴대전화·이메일이 비어 있는 같은 이름 고객은 같은 고객이라 반복해서 합쳐도 늘지 않는다', () => {
    const cur = base();
    cur.assistant = emptyAssistant();
    const inc = base();
    inc.assistant = emptyAssistant();
    createCustomer(inc.assistant, { name: '이름만 있는 고객' }, { now: NOW, ownerId: 'U1' });
    const once = applyMerge(cur, inc).state;
    expect(once.assistant!.customers.map((c) => c.name)).toEqual(['이름만 있는 고객']);
    const twice = applyMerge(once, inc).state;
    expect(twice.assistant!.customers.length).toBe(1);
    expect(sameCustomer(once.assistant!.customers[0], inc.assistant.customers[0])).toBe(true);
  });
  it('4: 고객 여럿을 한꺼번에 합쳐도 미팅 후 질문 상태가 중복되지 않는다(활동 ID 표가 고객마다 새로 만들어진다)', () => {
    const cur = base();
    cur.assistant = emptyAssistant();
    const inc = base();
    inc.assistant = emptyAssistant();
    const ia = inc.assistant;
    for (const name of ['가고객', '나고객', '다고객']) {
      const c = createCustomer(ia, { name, company: `${name} 상사(가상)` }, { now: NOW, ownerId: 'U1' }) as { id: string };
      const m = addInteraction(ia, c.id, { type: '미팅', date: '2026-10-29', title: `${name} 미팅` }, { now: NOW }) as { id: string };
      ia.followups.push({ interactionId: m.id, status: 'done', answers: {}, asked: [], updatedAt: '2026-10-30 09:00:00' });
    }
    const out = applyMerge(cur, inc).state.assistant!;
    expect(out.customers.length).toBe(3);
    expect(out.interactions.length).toBe(3);
    expect(out.followups.length).toBe(3); // 이전: 앞 고객의 활동 표가 쌓여 둘째 고객부터 중복 → 6
    expect(new Set(out.followups.map((f) => f.interactionId)).size).toBe(3);
    expect(out.followups.every((f) => out.interactions.some((i) => i.id === f.interactionId))).toBe(true);
  });
});

// ───────────── 5. 원문 보관 ─────────────
describe('검토 5: 「원문 보관」이 2만 자로 잘리지 않는다', () => {
  it('입력 상한 6만 자 + 머리말이 그대로 활동 상세에 들어간다', () => {
    expect(MAX_TEXT_CHARS).toBe(60000);
    expect(MAX_DETAILS_CHARS).toBeGreaterThanOrEqual(MAX_TEXT_CHARS + '[대화 원문]\n'.length);
    const a = seedA();
    const text = '가'.repeat(MAX_TEXT_CHARS);
    const p = prepareText(text);
    if (isErr(p)) throw new Error(p.error);
    const d = draftOf(a, '김도현', [], { original: p.original, sentText: p.sent });
    const r = applyDraft(a, d, [], { keepText: true }, NOW);
    if (isErr(r)) throw new Error(r.error);
    const details = a.interactions.find((i) => i.id === r.interactionId)!.details;
    expect(details.length).toBe('[대화 원문]\n'.length + MAX_TEXT_CHARS);
    expect(details.endsWith('가')).toBe(true);
    expect(isErr(prepareText('가'.repeat(MAX_TEXT_CHARS + 1)))).toBe(true);
  });
});

// ───────────── 6. 개인정보 가림 ─────────────
describe('검토 6: 가림 범위 확대와 오탐 없음', () => {
  const masked = (s: string) => maskText(s)[0];
  it.each([
    ['010 - 1234 - 5678', '[휴대전화]'],
    ['010 1234 5678', '[휴대전화]'],
    ['010.1234.5678', '[휴대전화]'],
    ['+82 10 1234 5678', '[휴대전화]'],
    ['+82-10-1234-5678', '[휴대전화]'],
    ['+82 2 123 4567', '[전화번호]'],
    ['1234 5678 9012 3456', '[번호]'],
    ['1234-5678-9012-3456', '[번호]'],
    ['110 123 456789', '[번호]'],
    ['110-123-456789', '[번호]'],
    ['900101 1234567', '[주민등록번호]'],
    ['900101-1234567', '[주민등록번호]'],
    ['1588-1234', '[전화번호]'],
    ['(02) 123-4567', '[전화번호]'],
    ['02-123-4567', '[전화번호]'],
    ['031 123 4567', '[전화번호]'],
    ['hong@example.co.kr', '[이메일]'],
  ])('가린다: %s', (raw, label) => {
    expect(masked(`연락처는 ${raw} 입니다.`)).toBe(`연락처는 ${label} 입니다.`);
    expect(maskText(raw)[1]).toBe(1);
  });
  it.each([
    '2026-10-30', '2026.10.30', '2026-10-30 14:30', '2026년 10월 30일 14시', '10월 30일', '14:30~15:30',
    '매출 1,200,000,000원', '출금 건수 12,345건', '금액 5,000 3,000 2,000', '1588 건', '총 1234건 중 5678건', '10 20 30 40', '3개월 6개월 12개월',
    '버전 1.2.3', '2026-11-05 ~ 2026-11-30', '건당 150원, 합계 15000원', '인원 120명 / 예산 3000 만원',
  ])('오탐 없음: %s', (raw) => {
    expect(maskText(raw)).toEqual([raw, 0]);
  });
  it('섞여 있어도 건수와 위치가 맞다', () => {
    const [out, n] = maskText('김 부장(010 - 1234 - 5678)이 2026-10-30 14:30에 1,200,000원 견적을 요청, 대표번호 1588-1234, 카드 1234 5678 9012 3456');
    expect(n).toBe(3);
    expect(out).toBe('김 부장([휴대전화])이 2026-10-30 14:30에 1,200,000원 견적을 요청, 대표번호 [전화번호], 카드 [번호]');
  });
});

// ───────────── 7. 연기됨 + 날짜 없음 ─────────────
describe('검토 7: 날짜 없는 「연기됨」은 취소가 되지 않는다', () => {
  function meeting() {
    const a = seedA();
    const c = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const m = addInteraction(a, c.id, { type: '미팅', date: '2026-10-29', time: '14:00', title: '시험 미팅' }, { now: NOW }) as { id: string };
    return { a, cid: c.id, mid: m.id };
  }
  it('다른 답은 그대로 두고(반영안에 남고) 날짜 입력을 안내하며 저장하지 않는다', () => {
    const { a, mid } = meeting();
    const answers = { held: { value: 'moved' }, request: { value: '자료 요청', content: '자료 보내기' } };
    const r = proposals(a, mid, answers, NOW)!;
    expect(r.problems.filter((p) => p.blocking).map((p) => p.qid)).toEqual(['held']);
    expect(r.proposals.some((p) => p.kind === 'meeting_cancel')).toBe(false);
    expect(r.proposals.map((p) => p.kind)).toEqual(['request']); // 다른 질문의 답(요청)은 반영안에 그대로 남는다
    // 날짜가 없는 연기여도 다른 질문의 안내(비운 요청 내용)는 계속 나온다
    const r2 = proposals(a, mid, { held: { value: 'moved' }, request: { value: '자료 요청', content: ' ' } }, NOW)!;
    expect(r2.problems.map((p) => [p.qid, p.blocking])).toEqual([['held', true], ['request', false]]);
    const snap = JSON.stringify(a);
    expect(isErr(applyFollowup(a, mid, answers, [{ idx: 0, include: true }], NOW))).toBe(true);
    expect(JSON.stringify(a)).toBe(snap);
    // 날짜를 넣으면 연기로 처리된다
    const ok = applyFollowup(a, mid, { held: { value: 'moved', new_date: '2026-11-05' } }, [{ idx: 0, include: true }], NOW);
    expect(ok).toMatchObject({ moved: true });
    expect(a.interactions.find((i) => i.id === mid)!.date).toBe('2026-11-05');
  });
});

// ───────────── 8. 최근 연락일 보존 ─────────────
describe('검토 8: 활동을 고치거나 지워도 직접 입력한 최근 연락일이 사라지지 않는다', () => {
  function setup() {
    const a = emptyAssistant();
    const c = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const old = addInteraction(a, c.id, { type: '통화', date: '2026-09-01', title: '옛 통화' }, { now: NOW }) as { id: string };
    const recent = addInteraction(a, c.id, { type: '미팅', date: '2026-10-10', title: '최근 미팅' }, { now: NOW }) as { id: string };
    updateCustomer(a, c.id, { lastContactDate: '2026-10-25' }, { now: NOW }); // 활동 밖에서 직접 입력한 연락일(전화 메모 등)
    return { a, cid: c.id, old: old.id, recent: recent.id };
  }
  it('제목·요약만 고치면 다시 계산하지 않는다', () => {
    const { a, cid, recent } = setup();
    expect(updateInteraction(a, recent, { title: '제목만 고침', summary: '요약' }, NOW)).toEqual({ ok: true });
    expect(a.customers.find((c) => c.id === cid)!.lastContactDate).toBe('2026-10-25');
  });
  it('날짜가 바뀌어도 직접 입력한 더 늦은 연락일은 지킨다. 지금 값이 그 활동 날짜였다면 다시 계산한다', () => {
    const { a, cid, old, recent } = setup();
    updateInteraction(a, old, { date: '2026-09-05' }, NOW);
    expect(a.customers.find((c) => c.id === cid)!.lastContactDate).toBe('2026-10-25');
    expect(a.customers.find((c) => c.id === cid)!.lastMeetingDate).toBe('2026-10-10');
    // 최근 미팅의 날짜를 앞으로 옮기면 최근 미팅일은 따라간다(지금 값이 그 활동의 옛 날짜)
    updateInteraction(a, recent, { date: '2026-10-02' }, NOW);
    expect(a.customers.find((c) => c.id === cid)!.lastMeetingDate).toBe('2026-10-02');
    expect(a.customers.find((c) => c.id === cid)!.lastContactDate).toBe('2026-10-25');
  });
  it('삭제는 지운 활동 날짜가 지금 값과 같을 때만 다시 계산한다', () => {
    const { a, cid, old, recent } = setup();
    expect(deleteInteraction(a, old, NOW)).toEqual({ ok: true });
    expect(a.customers.find((c) => c.id === cid)!.lastContactDate).toBe('2026-10-25'); // 건드리지 않음
    expect(deleteInteraction(a, recent, NOW)).toEqual({ ok: true });
    expect(a.customers.find((c) => c.id === cid)!.lastContactDate).toBe('2026-10-25'); // 최근 연락일은 활동 날짜(10-10)가 아니므로 유지
    expect(a.customers.find((c) => c.id === cid)!.lastMeetingDate).toBe(''); // 최근 미팅일은 지운 활동 날짜였으므로 다시 계산 → 없음
  });
  it('유형을 바꾸면 다시 계산한다(미팅 → 메모)', () => {
    const { a, cid, recent } = setup();
    updateInteraction(a, recent, { type: '메모' }, NOW);
    expect(a.customers.find((c) => c.id === cid)!.lastMeetingDate).toBe('');
  });
});

// ───────────── 9. 인용 대조 ─────────────
describe('검토 9: 인용 대조', () => {
  const SRC = `나: 부장님, 요즘 골프 자주 치시나요? 저는 요즘 회를 좋아해서요.
김도현: 아, 저는 회는 별로고 고기가 좋아요.
김도현: 주말마다 테니스를 배우느라 정신이 없어요. 그리고 출금 재시도 기능에 관심이 많아요.`;
  it('말머리를 떼기 전에 원문의 같은 말머리 줄인지 본다: 영업사원(나:)의 말을 고객(김도현:) 말로 인용하면 실패한다', () => {
    expect(verifyQuote('김도현: 저는 회는 별로고 고기가 좋아요.', SRC).ok).toBe(true);
    expect(verifyQuote('나: 저는 요즘 회를 좋아해서요.', SRC).ok).toBe(true);
    expect(verifyQuote('김도현: 저는 요즘 회를 좋아해서요.', SRC).ok).toBe(false); // 「나:」 줄의 말
    expect(verifyQuote('나: 저는 회는 별로고 고기가 좋아요.', SRC).ok).toBe(false); // 반대 방향도
    expect(verifyQuote('고객: 저는 회는 별로고 고기가 좋아요.', SRC).ok).toBe(false); // 원문에 없는 말머리
    expect(verifyQuote('저는 회는 별로고 고기가 좋아요.', SRC).ok).toBe(true); // 말머리 없는 인용은 그대로 통과
  });
  it('말줄임 조각은 원문에 나온 순서대로여야 한다', () => {
    expect(verifyQuote('주말마다 테니스를 배우느라 ... 출금 재시도 기능에 관심이', SRC).ok).toBe(true);
    expect(verifyQuote('출금 재시도 기능에 관심이 ... 주말마다 테니스를 배우느라', SRC).ok).toBe(false);
    expect(verifyQuote('저는 회는 별로고 ... 정신이 없어요', SRC).ok).toBe(true);
    expect(verifyQuote('정신이 없어요 ... 저는 회는 별로고', SRC).ok).toBe(false);
  });
  it('8자 미만 근거는 통과해도 「근거가 짧음」 경고와 기본 해제', () => {
    const a = seedA();
    const short = '골프 좋아해요'; // 공백 빼고 7자
    const src = `김도현: ${short}. 그리고 이런저런 이야기를 길게 나눴습니다.`;
    expect(verifyQuote(short, src)).toMatchObject({ ok: true, short: true });
    expect(verifyQuote('골프 좋아해요. 그리고 이런저런', src)).toMatchObject({ ok: true });
    expect(verifyQuote('골프 좋아해요. 그리고 이런저런', src).short).toBe(false);
    const items = verifyItems([
      { kind: 'profile', field: 'hobbies', fieldLabel: '취미·관심사', value: '골프', evidence: short, speaker: 'customer', confidence: 'high', isSpeculation: false, quoteVerified: false },
      { kind: 'profile', field: 'foodLikes', fieldLabel: '선호 음식', value: '고기', evidence: '골프 좋아해요. 그리고 이런저런', speaker: 'customer', confidence: 'high', isSpeculation: false, quoteVerified: false },
    ], src);
    expect(items.map((i) => [i.quoteVerified, !!i.quoteShort])).toEqual([[true, true], [true, false]]);
    const e = enrichDraft(a, { ...draftOf(a, '김도현', []), items }) as EnrichedDraft;
    expect(e.items[0].warnings).toEqual(['근거가 짧음']);
    expect(e.items[0].include).toBe(false);
    expect(e.items[1].warnings).toEqual([]);
  });
});

// ───────────── 10. 담당 영업자 변경 이력 ─────────────
describe('검토 10: 담당 영업자 변경은 변경 이력에 남고 복원 대상이 아니다. 전출·퇴직 화면에 담당 고객 수', () => {
  it('setCustomerOwner가 이력을 남긴다', () => {
    const s = createSeed('linked', NOW);
    const a = s.assistant!;
    s.currentUserId = 'U3'; // 팀장
    const c = cust(a, '김도현');
    expect(c.ownerId).toBe('U1');
    const r = setCustomerOwner(s, a, c.id, 'U2', 'U3', NOW);
    expect(r).toEqual({ changed: true });
    const h = a.changes.filter((x) => x.customerId === c.id && x.field === OWNER_FIELD);
    expect(h.length).toBe(1);
    expect(h[0]).toMatchObject({ oldValue: '김도윤', newValue: '이서연', source: 'manual', note: '담당 영업자 변경' });
    expect(labelChange(h[0]).fieldLabel).toBe('담당 영업자');
    // 복원 대상이 아니다
    expect(restoreChange(a, h[0].id, NOW)).toEqual({ error: '이 항목은 복원할 수 없습니다.' });
    expect(c.ownerId).toBe('U2');
    // 바뀐 것이 없으면 이력을 남기지 않는다
    expect(setCustomerOwner(s, a, c.id, 'U2', 'U3', NOW)).toEqual({ changed: false });
    expect(a.changes.filter((x) => x.field === OWNER_FIELD).length).toBe(1);
  });
  it('전출·퇴직 처리는 넘겨야 할 담당 고객 수를 돌려준다', () => {
    const s = createSeed('linked', NOW);
    expect(ownedCustomerCount(s, 'U1')).toBe(18);
    const r = setPersonStatus(JSON.parse(JSON.stringify(s)) as AppState, 'U2', 'left');
    expect(r).toMatchObject({ ownedCustomers: 0 });
    s.currentUserId = 'U3';
    const r1 = setPersonStatus(JSON.parse(JSON.stringify(s)) as AppState, 'U1', 'left');
    expect(r1).toMatchObject({ ownedCustomers: 18 });
    expect(personUsages(s, 'U1')).toContain('AI 비서 고객 담당 18건');
  });
});

// ───────────── 11. 사용자별 읽음·보는 범위 ─────────────
describe('검토 11: 알림·오늘을 사용자별로(기본은 내 담당 고객만)', () => {
  const state = () => {
    const s = createSeed('linked', NOW);
    // 고객 일부를 U2(같은 팀 팀원)에게 넘긴다
    const a = s.assistant!;
    for (const n of ['김도현', '장태우', '오정석', '이서연', '최유진']) cust(a, n).ownerId = 'U2';
    return s;
  };
  it('범위: 내 담당 / 내 조직 전체(조직장만) / 전체 보기', () => {
    const s = state();
    const a = s.assistant!;
    expect(scopeChoices(s, 'U1')).toEqual(['mine', 'all']);
    expect(scopeChoices(s, 'U3')).toEqual(['mine', 'org', 'all']);
    expect(effectiveScope(s, 'U1', 'org')).toBe('mine'); // 조직장이 아니면 「내 조직 전체」는 못 쓴다
    expect(customerIdsInScope(s, a, 'U1', 'mine')!.size).toBe(13);
    expect(customerIdsInScope(s, a, 'U2', 'mine')!.size).toBe(5);
    expect(customerIdsInScope(s, a, 'U1', 'all')).toBeNull();
    // 팀장 U3: 본인 담당 0명, 내 조직 전체 = 같은 팀 U1·U2의 고객 18명
    expect(customerIdsInScope(s, a, 'U3', 'mine')!.size).toBe(0);
    expect(customerIdsInScope(s, a, 'U3', 'org')!.size).toBe(18);
    const f = filterAssistant(a, customerIdsInScope(s, a, 'U2', 'mine'));
    expect(f.customers.length).toBe(5);
    expect(f.interactions.every((i) => f.customers.some((c) => c.id === i.customerId))).toBe(true);
    expect(f.requests.every((r) => f.customers.some((c) => c.id === r.customerId))).toBe(true);
    expect(a.customers.length).toBe(18); // 원본은 그대로
  });
  it('알림·메뉴 숫자·오늘 화면이 범위를 따른다', () => {
    const s = state();
    const a = s.assistant!;
    const all = computeNotices(a, NOW).length;
    const mine1 = computeNotices(a, NOW, { userId: 'U1', ids: customerIdsInScope(s, a, 'U1', 'mine') });
    const mine2 = computeNotices(a, NOW, { userId: 'U2', ids: customerIdsInScope(s, a, 'U2', 'mine') });
    expect(mine1.length + mine2.length).toBe(all);
    expect(mine1.length).toBeGreaterThan(0);
    expect(mine2.length).toBeGreaterThan(0);
    expect(mine1.every((n) => cust(a, '김도현').id !== n.customerId)).toBe(true);
    expect(unreadCount(a, NOW, { userId: 'U1', ids: customerIdsInScope(s, a, 'U1', 'mine') })).toBe(mine1.length);
    const t1 = buildToday(filterAssistant(a, customerIdsInScope(s, a, 'U1', 'mine')), NOW);
    expect(t1.total).toBe(13);
    expect(t1.meetings.every((m) => cust(a, m.name).ownerId === 'U1')).toBe(true);
  });
  it('읽음 표시는 사용자별: 한 사람이 읽어도 다른 사람의 읽지 않은 수가 줄지 않는다', () => {
    const s = createSeed('linked', NOW);
    const a = s.assistant!;
    const v1 = { userId: 'U1', ids: null };
    const v2 = { userId: 'U2', ids: null };
    const n0 = unreadCount(a, NOW, v1);
    expect(n0).toBeGreaterThan(2);
    const first = computeNotices(a, NOW, v1)[0];
    markNoticeRead(a, first.key, NOW, 'U1');
    expect(a.noticeRead).toContain(`U1:${first.key}`);
    expect(unreadCount(a, NOW, v1)).toBe(n0 - 1);
    expect(unreadCount(a, NOW, v2)).toBe(n0); // U2는 그대로
    markAllNoticesRead(a, NOW, v2);
    expect(unreadCount(a, NOW, v2)).toBe(0);
    expect(unreadCount(a, NOW, v1)).toBe(n0 - 1); // U1의 읽음은 U2가 바꾸지 않는다
    // 옛 방식(키 그대로, 사용자 없음)은 사용자별 읽음과 섞이지 않는다
    a.noticeRead.push(first.key);
    expect(unreadCount(a, NOW, { userId: 'U3', ids: null })).toBe(n0);
  });
  it('범위 안에서만 모두 읽음으로 한다', () => {
    const s = state();
    const a = s.assistant!;
    const ids = customerIdsInScope(s, a, 'U2', 'mine');
    markAllNoticesRead(a, NOW, { userId: 'U2', ids });
    expect(unreadCount(a, NOW, { userId: 'U2', ids })).toBe(0);
    expect(unreadCount(a, NOW, { userId: 'U2', ids: null })).toBeGreaterThan(0); // 전체 보기에는 내 담당이 아닌 알림이 남아 있다
  });
});

// ───────────── 12. 미팅 후 질문 ─────────────
describe('검토 12: 미팅 후 질문 재응답·반영안 그대로 저장·빈 답 안내·날짜 문구', () => {
  function meeting(date = '2026-10-29') {
    const a = seedA();
    const c = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const m = addInteraction(a, c.id, { type: '미팅', date, time: '14:00', title: '시험 미팅' }, { now: NOW }) as { id: string };
    return { a, cid: c.id, mid: m.id };
  }
  const ANS = { request: { value: '자료 요청', content: '실적 자료 전달', due_date: '2026-11-05' }, food_ate: { value: '한식' }, interest: { value: '업무·사업', text: '출금 재시도' } };
  it('다시 응답해도 같은 요청·같은 메모가 두 번 저장되지 않는다', () => {
    const { a, cid, mid } = meeting();
    const p1 = proposals(a, mid, ANS, NOW)!;
    expect(p1.proposals.map((p) => p.kind)).toEqual(['request', 'field', 'meeting_note']);
    const r1 = applyFollowup(a, mid, ANS, p1.proposals.map((_, idx) => ({ idx, include: true })), NOW);
    expect(r1).toMatchObject({ applied: 3 });
    const reqs = () => a.requests.filter((r) => r.customerId === cid && r.interactionId === mid);
    expect(reqs().length).toBe(1);
    // 같은 답으로 한 번 더(완료된 질문을 다시 열어 응답)
    const p2 = proposals(a, mid, ANS, NOW)!;
    expect(p2.proposals).toEqual([]); // 이미 저장한 요청·메모·고객 항목은 반영안이 없다
    applyFollowup(a, mid, ANS, [{ idx: 0, include: true }, { idx: 1, include: true }], NOW);
    expect(reqs().length).toBe(1);
    expect(a.interactions.find((i) => i.id === mid)!.details.match(/\[미팅 후 확인/g)!.length).toBe(1);
    // 화면에서 넘어온 옛 반영안으로 저장해도 중복되지 않는다
    applyFollowup(a, mid, ANS, p1.proposals.map((_, idx) => ({ idx, include: true })), NOW, '', p1.proposals);
    expect(reqs().length).toBe(1);
    expect(a.interactions.find((i) => i.id === mid)!.details.match(/\[미팅 후 확인/g)!.length).toBe(1);
  });
  it('확인 때 만든 반영안을 그대로 저장에 넘기면 선택 번호가 어긋나지 않는다(그 사이에 고객 정보가 바뀌어도)', () => {
    const { a, cid, mid } = meeting();
    const p = proposals(a, mid, ANS, NOW)!.proposals; // [request, field(recentInterests), meeting_note]
    // 확인 뒤에 다른 곳에서 최근 관심 주제가 채워져 다시 계산하면 field 반영안이 사라진다 → 번호가 한 칸씩 당겨짐
    updateCustomer(a, cid, { recentInterests: '출금 재시도' }, { now: NOW });
    expect(proposals(a, mid, ANS, NOW)!.proposals.map((x) => x.kind)).toEqual(['request', 'meeting_note']);
    // 사용자가 보고 체크한 것은 요청(0)과 메모(2) — 번호 2는 다시 계산한 목록에는 없다
    const r = applyFollowup(a, mid, ANS, [{ idx: 0, include: true }, { idx: 2, include: true }], NOW, '', p);
    expect(r).toMatchObject({ applied: 2 });
    expect(a.requests.filter((x) => x.interactionId === mid).length).toBe(1);
    expect(a.interactions.find((i) => i.id === mid)!.details).toContain('[미팅 후 확인 2026-10-29]');
    // 알 수 없는 반영안은 거부한다
    const bad = applyFollowup(a, mid, ANS, [{ idx: 0, include: true }], NOW, '', [{ kind: 'field', field: 'nope' as never, label: 'x', old: '', new: 'y' }]);
    expect(isErr(bad)).toBe(true);
  });
  it('확인 전에 내용을 비워 빠지는 답은 그 질문에 「내용을 적어야 저장됩니다」 안내를 돌려준다(막지는 않음)', () => {
    const { a, mid } = meeting();
    const r = proposals(a, mid, { request: { value: '자료 요청', content: '  ' }, interest: { value: '업무·사업', text: '' }, food_pref: { value: 'like' } }, NOW)!;
    expect(r.proposals).toEqual([]);
    expect(buildQuestions(a, mid, NOW)!.questions.map((q) => q.id)).toContain('food_pref');
    expect(r.problems.map((p) => [p.qid, p.text, p.blocking])).toEqual([['request', '내용을 적어야 저장됩니다.', false], ['food_pref', '내용을 적어야 저장됩니다.', false], ['interest', '내용을 적어야 저장됩니다.', false]]);
    // 묻지 않은 질문의 답은 안내도 하지 않는다
    expect(proposals(a, mid, { org: { value: 'set' } }, NOW)!.problems.map((p) => p.qid)).toEqual([]);
  });
  it('질문 문구의 「오늘」은 미팅 날짜 기준, 메모 날짜는 미팅 날짜', () => {
    const { a, mid } = meeting('2026-10-29');
    const q = buildQuestions(a, mid, NOW)!.questions;
    expect(q.find((x) => x.id === 'request')!.text).toBe('10월 29일 시험고객님이 새롭게 요청한 업무가 있었나요?');
    expect(q.find((x) => x.id === 'food_ate')!.text).toContain('10월 29일 ');
    expect(q.find((x) => x.id === 'interest')!.text).toBe('10월 29일 대화에서 고객이 관심을 보인 주제가 있었나요?');
    const t = meeting('2026-10-30');
    expect(buildQuestions(t.a, t.mid, NOW)!.questions.find((x) => x.id === 'request')!.text).toBe('오늘 시험고객님이 새롭게 요청한 업무가 있었나요?');
    expect(meetingDayWord('2025-12-31', '2026-10-30')).toBe('2025년 12월 31일');
    const note = proposals(a, mid, { food_ate: { value: '한식' } }, NOW)!.proposals.find((p) => p.kind === 'meeting_note')!;
    expect(note.new).toBe('[미팅 후 확인 2026-10-29] 식사: 한식');
  });
});

// ───────────── 13. 고객 입력 검증 ─────────────
describe('검토 13: 고객 입력 검증', () => {
  const mk = (extra: Record<string, string>) => createCustomer(emptyAssistant(), { name: '검증', ...extra }, { now: NOW, ownerId: 'U1' });
  it('이메일 형식', () => {
    expect(mk({ email: 'abc' })).toEqual({ error: '이메일 형식이 올바르지 않습니다. (예: name@example.com)', field: 'email' });
    expect(mk({ email: 'a@b' })).toMatchObject({ field: 'email' });
    expect('id' in (mk({ email: 'a.b@c.example' }) as object)).toBe(true);
    expect('id' in (mk({ email: '' }) as object)).toBe(true);
  });
  it('휴대전화·사무실 전화는 숫자 8자리 이상', () => {
    expect(mk({ mobile: '1234567' })).toEqual({ error: '휴대전화은(는) 숫자 8자리 이상으로 입력해 주세요.', field: 'mobile' });
    expect(mk({ officePhone: '02-123' })).toMatchObject({ field: 'officePhone' });
    expect('id' in (mk({ mobile: '010-0000-1234', officePhone: '02-1234-5678' }) as object)).toBe(true);
    expect('id' in (mk({ mobile: '12345678' }) as object)).toBe(true);
  });
  it('생년월일·최초 만남일·최근 연락일·최근 미팅일은 미래 불가, 다음 연락 예정일은 미래 가능', () => {
    expect(mk({ birthDate: '2026-10-31' })).toMatchObject({ field: 'birthDate' });
    expect(mk({ firstMetDate: '2027-01-01' })).toMatchObject({ field: 'firstMetDate' });
    expect(mk({ lastContactDate: '2026-10-31' })).toMatchObject({ field: 'lastContactDate' });
    expect(mk({ lastMeetingDate: '2026-11-30' })).toMatchObject({ field: 'lastMeetingDate' });
    for (const f of ['birthDate', 'firstMetDate', 'lastContactDate', 'lastMeetingDate']) expect('id' in (mk({ [f]: '2026-10-30' }) as object)).toBe(true); // 오늘까지는 가능
    expect('id' in (mk({ nextContactDate: '2027-01-01' }) as object)).toBe(true);
  });
  it('수정: 바뀐 항목만 검사한다(예전에 저장된 값 때문에 수정이 막히지 않음). 복원은 검사하지 않는다', () => {
    const a = emptyAssistant();
    const c = createCustomer(a, { name: '옛 고객' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    cust(a, '옛 고객').mobile = '123'; // 옛 데이터
    cust(a, '옛 고객').email = 'x';
    expect(updateCustomer(a, c.id, { mobile: '123', email: 'x', hobbies: '바둑' }, { now: NOW })).toEqual({ changed: ['hobbies'] });
    expect(updateCustomer(a, c.id, { mobile: '1234' }, { now: NOW })).toMatchObject({ field: 'mobile' });
    expect(updateCustomer(a, c.id, { email: 'new@ok.example' }, { now: NOW })).toEqual({ changed: ['email'] });
    // 복원: 옛 값(검사를 통과하지 못하는 값)으로 되돌릴 수 있다
    const h = a.changes.find((x) => x.field === 'email')!;
    expect(restoreChange(a, h.id, NOW)).toEqual({ field: 'email', value: 'x' });
  });
  it('fieldValueError를 AI 반영(대화 분석)·미팅 후 질문도 같이 쓴다: 미래 생년월일은 저장 전에 거부', () => {
    expect(fieldValueError('birthDate', '2026-12-01', NOW)).toContain('오늘 이후');
    const a = seedA();
    const d = draftOf(a, '김도현', [{ field: 'birthDate', fieldLabel: '생년월일', value: '2027-01-01' }]);
    const snap = JSON.stringify(a);
    expect(applyDraft(a, d, [{ idx: 0, include: true }], {}, NOW)).toMatchObject({ field: 'birthDate' });
    expect(JSON.stringify(a)).toBe(snap); // 활동 기록도 만들지 않는다
  });
  it('요청 처리기한이 접수일보다 앞서면 저장은 하되 경고', () => {
    const a = seedA();
    const cid = cust(a, '김도현').id;
    const r = addRequest(a, cid, { content: '시험 요청', receivedDate: '2026-10-30', dueDate: '2026-10-20' }, { now: NOW });
    expect(r).toMatchObject({ warning: '처리기한이 접수일보다 앞서 있습니다. 날짜를 다시 확인해 보세요.' });
    expect(a.requests.some((x) => x.content === '시험 요청')).toBe(true);
    const ok = addRequest(a, cid, { content: '정상 요청', receivedDate: '2026-10-30', dueDate: '2026-11-20' }, { now: NOW });
    expect('warning' in (ok as object)).toBe(false);
    const id = (r as { id: string }).id;
    expect(updateRequest(a, id, { dueDate: '2026-11-01' }, NOW)).toEqual({ ok: true });
    expect(updateRequest(a, id, { dueDate: '2026-10-01' }, NOW)).toMatchObject({ ok: true, warning: expect.any(String) });
  });
});

// ───────────── 14. 예시 분석 승인 ─────────────
describe('검토 14: 예시 분석 승인', () => {
  it('최근 연락일을 바꾸지 않고, 파일명은 고객 이름 없는 「예시 대화」', () => {
    expect(SAMPLE_FILE).toBe('예시 대화');
    expect(SAMPLE_FILE).not.toMatch(/김도현|kim/i);
    const a = seedA();
    const before = { ...cust(a, '김도현') };
    const d = sampleDraft(a, before.id, NOW);
    if (isErr(d)) throw new Error(d.error);
    expect(d.filename).toBe('예시 대화');
    const r = applyDraft(a, d, [], {}, NOW);
    if (isErr(r)) throw new Error(r.error);
    expect(cust(a, '김도현').lastContactDate).toBe(before.lastContactDate);
    expect(cust(a, '김도현').lastMeetingDate).toBe(before.lastMeetingDate);
    const m = a.interactions.find((i) => i.id === r.interactionId)!;
    expect(m).toMatchObject({ source: 'sample', sourceFile: '예시 대화' });
  });
});

// ───────────── 15·16. 가상 데이터 ─────────────
describe('검토 15·16: 가상 데이터 다시 채우기 안내, 빈 시드', () => {
  it('건너뛴 고객을 이름과 함께 알린다', () => {
    const a = seedA();
    const gone = cust(a, '김도현');
    // 김도현을 지우고 다른 사람은 그대로: 17명이 건너뛰어지고 1명이 채워진다
    a.customers = a.customers.filter((c) => c.id !== gone.id);
    const r = restoreDemoReport(a, NOW, 'U1');
    expect(r.added).toBe(1);
    expect(r.skipped.length).toBe(17);
    expect(restoreDemoMessage({ added: 0, skipped: [{ name: '김도현', company: '가온은행' }] })).toBe('더할 가상 고객이 없습니다. 1명 건너뜀: 김도현(같은 이름·소속 고객 있음)');
    expect(restoreDemoMessage({ added: 17, skipped: [{ name: '김도현', company: '가온은행' }] })).toBe('가상 고객 17명을 채웠습니다(담당: 지금 사용자). 1명 건너뜀: 김도현(같은 이름·소속 고객 있음)');
    expect(restoreDemoMessage({ added: 18, skipped: [] })).toBe('가상 고객 18명을 채웠습니다(담당: 지금 사용자)');
    // 많이 건너뛰면 앞 5명만 이름으로 보이고 나머지는 「외 N명」
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `고객${i + 1}`, company: '가상' }));
    expect(restoreDemoMessage({ added: 0, skipped: many })).toBe('더할 가상 고객이 없습니다. 8명 건너뜀: 고객1(같은 이름·소속 고객 있음), 고객2(같은 이름·소속 고객 있음), 고객3(같은 이름·소속 고객 있음), 고객4(같은 이름·소속 고객 있음), 고객5(같은 이름·소속 고객 있음) 외 3명');
  });
  it('createSeed(fresh)는 고객을 채우지 않는다', () => {
    const s = createSeed('fresh', NOW);
    expect(s.assistant!.customers).toEqual([]);
    expect(createSeed('linked', NOW).assistant!.customers.length).toBe(18);
  });
});

// ───────────── 21. 바로 찾기(Ctrl+K)에 고객 ─────────────
describe('검토 21: 바로 찾기에 고객(이름·초성·소속)', async () => {
  const { quickFind, flatten, buildItems } = await import('../src/lib/quickFind');
  const s = createSeed('linked', NOW);
  const customers = (q: string) => flatten(quickFind(s, q)).filter((i) => i.kind === 'customer');
  it('이름·이름 일부로 찾고, 고른 고객 상세로 이동한다', () => {
    const hit = customers('김도현');
    expect(hit.map((i) => i.title)).toEqual(['김도현']);
    expect(hit[0].to).toBe(`/assistant/customers/${cust(s.assistant!, '김도현').id}`);
    expect(hit[0].sub).toBe('부장 · 가온은행 · 자금결제부');
    expect(customers('도현').map((i) => i.title)).toContain('김도현');
  });
  it('초성으로도 찾는다(이름 초성, 소속 초성)', () => {
    expect(customers('ㄱㄷㅎ').map((i) => i.title)).toContain('김도현');
    expect(customers('ㄱㅇㅇㅎ').map((i) => i.title)).toContain('김도현'); // 가온은행
  });
  it('소속으로도 찾는다', () => {
    const names = customers('가온은행').map((i) => i.title);
    expect(names).toContain('김도현');
  });
  it('고객은 종류 「고객」으로 묶이고, 빈 검색어에는 나오지 않는다. 기존 종류 순서는 그대로', () => {
    const g = quickFind(s, '김도현');
    expect(g.some((x) => x.kind === 'customer')).toBe(true);
    expect(quickFind(s, '').map((x) => x.kind)).toEqual(['menu', 'action']);
    expect(buildItems(s).filter((i) => i.kind === 'customer').length).toBe(18);
    // 고객이 없으면(빈 비서 칸) 항목도 없다
    const empty = { ...s, assistant: undefined };
    expect(buildItems(empty).some((i) => i.kind === 'customer')).toBe(false);
  });
});
