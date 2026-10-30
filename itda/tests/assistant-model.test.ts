// AI 비서 데이터 명령: 고객 CRUD·변경 이력·복원·중복·최근 연락일·이력 상한, 활동·요청·기념일 값 검사. 가상 데이터만.
import { describe, expect, it } from 'vitest';
import {
  addAnniversary, addInteraction, addRequest, applyActivityDates, cleanFields, cleanRemindDays, createCustomer, deleteAnniversary, deleteCustomer, deleteInteraction, deleteRequest, emptyAssistant,
  findDuplicates, HISTORY_LIMIT_PER_CUSTOMER, isErr, recomputeActivityDates, restoreChange, updateAnniversary, updateCustomer, updateInteraction, updateRequest,
} from '../src/assistant/model';
import { addDays, isValidDate, nextOccurrence, pyRound, ymd } from '../src/assistant/dates';
import { createAssistantSeed } from '../src/assistant/seed';
import { setState } from '../src/assistant/followup';
import type { AssistantData } from '../src/assistant/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0);
const T = ymd(NOW);
/** 오류가 아니면 값을 돌려준다 */
function ok<T>(r: T | { error: string }): T {
  if (isErr(r)) throw new Error(r.error);
  return r;
}
function one(a: AssistantData, name = '시험고객', extra: Record<string, string> = {}) {
  return ok(createCustomer(a, { name, company: '시험상사(가상)', ...extra }, { now: NOW, ownerId: 'U1' }) as { id: string } | { error: string }).id;
}

describe('고객 등록', () => {
  it('이름은 필수, 날짜는 달력에 있어야 한다', () => {
    const a = emptyAssistant();
    expect(createCustomer(a, { name: '  ' }, { now: NOW, ownerId: 'U1' })).toEqual({ error: '이름은 필수 입력 항목입니다.' });
    expect(createCustomer(a, { name: '가나다', birthDate: '2026-13-01' }, { now: NOW, ownerId: 'U1' })).toEqual({ error: '생년월일이(가) 존재하지 않는 날짜입니다.' });
    expect(createCustomer(a, { name: '가나다', birthDate: '2026/01/01' }, { now: NOW, ownerId: 'U1' })).toEqual({ error: '생년월일 형식이 올바르지 않습니다. (예: 2026-11-05)' });
    expect(a.customers).toEqual([]);
  });
  it('값은 공백을 다듬고 4000자까지, 유형이 목록에 없으면 「기타」', () => {
    expect(cleanFields({ name: '  홍  ', customerType: '아무거나', notes: 'x' } as never)).toEqual({ name: '홍', customerType: '기타' });
    expect(cleanFields({ salesNotes: 'a'.repeat(5000) }).salesNotes!.length).toBe(4000);
  });
  it('등록 이력: 값이 있는 항목마다 「최초 등록」(직접 입력), 담당 영업자가 붙는다', () => {
    const a = emptyAssistant();
    const id = one(a, '가나다', { mobile: '010-0000-9999' });
    const c = a.customers.find((x) => x.id === id)!;
    expect(c.ownerId).toBe('U1');
    expect(c.isDemo).toBe(false);
    const h = a.changes.filter((x) => x.customerId === id);
    expect(h.map((x) => x.field).sort()).toEqual(['company', 'mobile', 'name']);
    expect(h.every((x) => x.oldValue === '' && x.source === 'manual' && x.note === '최초 등록')).toBe(true);
  });
  it('데모 고객은 등록 이력을 저장하지 않는다(CR-25 2.3-8)', () => {
    const a = emptyAssistant();
    ok(createCustomer(a, { name: '가상', mobile: '010-0000-1' }, { now: NOW, ownerId: 'U1', isDemo: true }) as { id: string });
    expect(a.changes).toEqual([]);
  });
  it('중복 후보: 이름+소속, 휴대전화(숫자 8자리 이상), 이메일. force면 그래도 등록', () => {
    const a = emptyAssistant();
    const id = one(a, '김시험', { mobile: '010-1111-2222', email: 'A@Test.example' });
    expect(findDuplicates(a, { name: '김시험', company: '시험상사(가상)' })[0].reasons).toEqual(['이름·소속 일치']);
    expect(findDuplicates(a, { name: '김시험', company: '다른회사' })[0].reasons).toEqual(['이름 일치']);
    expect(findDuplicates(a, { name: '다른사람', mobile: '01011112222' })[0].reasons).toEqual(['휴대전화 일치']);
    expect(findDuplicates(a, { name: '다른사람', email: 'a@test.EXAMPLE' })[0].reasons).toEqual(['이메일 일치']);
    expect(findDuplicates(a, { name: '다른사람', mobile: '1234' })).toEqual([]);
    expect(findDuplicates(a, { name: '김시험' }, id)).toEqual([]);
    const r = createCustomer(a, { name: '김시험', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' });
    expect('duplicates' in r && r.duplicates.length).toBe(1);
    expect(a.customers.length).toBe(1);
    expect('id' in createCustomer(a, { name: '김시험', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1', force: true })).toBe(true);
    expect(a.customers.length).toBe(2);
  });
});

describe('고객 수정·변경 이력·복원', () => {
  it('바뀐 항목만 이력(전·후·출처·메모)을 남기고 갱신일을 바꾼다', () => {
    const a = emptyAssistant();
    const id = one(a, '가나다', { hobbies: '골프' });
    const later = new Date(2026, 9, 31, 9, 0, 0);
    const r = ok(updateCustomer(a, id, { hobbies: '골프, 등산', company: '시험상사(가상)' }, { now: later, source: 'manual', note: '시험' }));
    expect(r.changed).toEqual(['hobbies']);
    const last = a.changes.at(-1)!;
    expect(last).toMatchObject({ field: 'hobbies', oldValue: '골프', newValue: '골프, 등산', source: 'manual', note: '시험', changedAt: '2026-10-31 09:00:00' });
    expect(a.customers[0].updatedAt).toBe('2026-10-31 09:00:00');
    const n = a.changes.length;
    expect(ok(updateCustomer(a, id, { hobbies: '골프, 등산' }, { now: later })).changed).toEqual([]);
    expect(a.changes.length).toBe(n);
  });
  it('이름을 비우거나 없는 고객이나 잘못된 날짜는 오류이고 아무것도 바뀌지 않는다', () => {
    const a = emptyAssistant();
    const id = one(a);
    const snap = JSON.stringify(a);
    expect(updateCustomer(a, id, { name: ' ' }, { now: NOW })).toEqual({ error: '이름은 비워둘 수 없습니다.' });
    expect(updateCustomer(a, 'CU-999', { name: 'x' }, { now: NOW })).toEqual({ error: '고객을 찾을 수 없습니다.' });
    expect(updateCustomer(a, id, { nextContactDate: '2026-02-30', hobbies: '바둑' }, { now: NOW })).toEqual({ error: '다음 연락·미팅 예정일이(가) 존재하지 않는 날짜입니다.' });
    expect(JSON.stringify(a)).toBe(snap);
  });
  it('복원: 이전 값으로 되돌리고 복원도 이력으로 남는다. 이름을 빈 값으로는 못 되돌린다', () => {
    const a = emptyAssistant();
    const id = one(a, '가나다', { hobbies: '골프' });
    ok(updateCustomer(a, id, { hobbies: '등산' }, { now: NOW, source: 'ai', note: 'AI' }));
    const h = a.changes.find((x) => x.field === 'hobbies' && x.newValue === '등산')!;
    expect(ok(restoreChange(a, h.id, NOW))).toEqual({ field: 'hobbies', value: '골프' });
    expect(a.customers[0].hobbies).toBe('골프');
    expect(a.changes.at(-1)).toMatchObject({ field: 'hobbies', oldValue: '등산', newValue: '골프', source: 'restore' });
    expect(a.changes.at(-1)!.note).toContain('변경 이전 값으로 복원');
    const nameFirst = a.changes.find((x) => x.field === 'name')!;
    expect(restoreChange(a, nameFirst.id, NOW)).toEqual({ error: '이름을 빈 값으로 복원할 수 없습니다.' });
    expect(restoreChange(a, 'CH-999', NOW)).toEqual({ error: '변경 이력을 찾을 수 없습니다.' });
  });
  it('고객당 변경 이력 상한(기본 200)을 넘으면 오래된 것부터 지운다, 다른 고객은 그대로', () => {
    expect(HISTORY_LIMIT_PER_CUSTOMER).toBe(200);
    const a = emptyAssistant();
    const x = one(a, '가나다');
    const y = one(a, '라마바');
    const yBefore = a.changes.filter((c) => c.customerId === y).length;
    for (let i = 0; i < 230; i++) ok(updateCustomer(a, x, { hobbies: `취미${i}` }, { now: NOW }));
    const mine = a.changes.filter((c) => c.customerId === x);
    expect(mine.length).toBe(200);
    expect(mine.at(-1)!.newValue).toBe('취미229'); // 가장 최근 것은 남는다
    expect(mine.some((c) => c.field === 'name')).toBe(false); // 가장 오래된 등록 이력부터 사라졌다
    expect(a.changes.filter((c) => c.customerId === y).length).toBe(yBefore);
  });
});

describe('고객 삭제', () => {
  it('하위 기록(활동·요청·기념일·변경 이력·질문 상태)을 함께 지우고 다른 고객은 그대로', () => {
    const a = createAssistantSeed(NOW, 'U1');
    const target = a.customers.find((c) => c.name === '김도현')!;
    ok(updateCustomer(a, target.id, { hobbies: '골프, 등산, 낚시' }, { now: NOW })); // 이력 1건
    ok(addAnniversary(a, target.id, { kind: '생일', date: '2000-01-01' }, { now: NOW }));
    const m = a.interactions.find((i) => i.customerId === target.id && i.type === '미팅')!;
    setState(a, m.id, 'done', NOW, { held: { value: 'yes' } }, ['held']);
    const other = JSON.stringify({ i: a.interactions.filter((i) => i.customerId !== target.id), r: a.requests.filter((r) => r.customerId !== target.id), f: a.followups.filter((f) => f.interactionId !== m.id) });
    const r = ok(deleteCustomer(a, target.id));
    expect(r.removed.interactions).toBe(3);
    expect(r.removed.requests).toBe(1);
    expect(r.removed.anniversaries).toBe(1);
    expect(r.removed.changes).toBe(1);
    expect(a.customers.length).toBe(17);
    for (const k of ['interactions', 'requests', 'anniversaries', 'changes'] as const) expect(a[k].some((x) => x.customerId === target.id)).toBe(false);
    expect(a.followups.some((f) => f.interactionId === m.id)).toBe(false);
    expect(JSON.stringify({ i: a.interactions, r: a.requests, f: a.followups })).toBe(other);
    expect(deleteCustomer(a, target.id)).toEqual({ error: '고객을 찾을 수 없습니다.' });
  });
});

describe('활동 기록과 최근 연락일·미팅일', () => {
  it('오늘까지의 미팅·통화·이메일이 최근 연락일(·미팅일)을 올리고 이력은 「활동기록 자동 반영」', () => {
    const a = emptyAssistant();
    const id = one(a);
    ok(addInteraction(a, id, { type: '통화', date: '2026-10-20', title: '통화' }, { now: NOW }));
    expect(a.customers[0]).toMatchObject({ lastContactDate: '2026-10-20', lastMeetingDate: '' });
    ok(addInteraction(a, id, { type: '미팅', date: '2026-10-25', title: '미팅' }, { now: NOW }));
    expect(a.customers[0]).toMatchObject({ lastContactDate: '2026-10-25', lastMeetingDate: '2026-10-25' });
    const auto = a.changes.filter((c) => c.source === 'activity');
    expect(auto.length).toBe(3); // 연락일, 연락일, 미팅일
    expect(auto[0].note).toBe('통화 기록 추가');
  });
  it('오늘 이후(예정)·메모·기타 유형은 올리지 않고, 더 옛날 기록도 내리지 않는다', () => {
    const a = emptyAssistant();
    const id = one(a);
    ok(addInteraction(a, id, { type: '미팅', date: '2026-11-05', title: '예정' }, { now: NOW }));
    ok(addInteraction(a, id, { type: '메모', date: '2026-10-29', title: '메모' }, { now: NOW }));
    ok(addInteraction(a, id, { type: '기타', date: '2026-10-29', title: '기타' }, { now: NOW }));
    expect(a.customers[0].lastContactDate).toBe('');
    ok(addInteraction(a, id, { type: '통화', date: '2026-10-28', title: '통화' }, { now: NOW }));
    ok(addInteraction(a, id, { type: '통화', date: '2026-10-01', title: '옛 통화' }, { now: NOW }));
    expect(a.customers[0].lastContactDate).toBe('2026-10-28');
    applyActivityDates(a, id, '통화', '', NOW); // 날짜 없으면 무시
    expect(a.customers[0].lastContactDate).toBe('2026-10-28');
  });
  it('활동을 고치거나 지우면 다시 계산한다(지금까지 중 가장 늦은 날짜, 없으면 빈 값)', () => {
    const a = emptyAssistant();
    const id = one(a);
    const m1 = ok(addInteraction(a, id, { type: '미팅', date: '2026-10-10', title: 'm1' }, { now: NOW })).id;
    const m2 = ok(addInteraction(a, id, { type: '미팅', date: '2026-10-25', title: 'm2' }, { now: NOW })).id;
    expect(a.customers[0].lastMeetingDate).toBe('2026-10-25');
    ok(updateInteraction(a, m2, { date: '2026-12-01' }, NOW)); // 미래로 옮김 → 오늘 이전은 m1뿐
    expect(a.customers[0]).toMatchObject({ lastMeetingDate: '2026-10-10', lastContactDate: '2026-10-10' });
    ok(deleteInteraction(a, m1, NOW));
    expect(a.customers[0]).toMatchObject({ lastMeetingDate: '', lastContactDate: '' });
    recomputeActivityDates(a, id, NOW); // 다시 해도 같다
    expect(a.customers[0].lastContactDate).toBe('');
  });
  it('활동 삭제: 연결된 요청사항은 남고 연결만 끊긴다, 질문 상태는 지워진다', () => {
    const a = emptyAssistant();
    const id = one(a);
    const m = ok(addInteraction(a, id, { type: '미팅', date: '2026-10-10', title: 'm' }, { now: NOW })).id;
    const r = ok(addRequest(a, id, { content: '자료 전달', interactionId: m }, { now: NOW })).id;
    setState(a, m, 'skipped', NOW);
    ok(deleteInteraction(a, m, NOW));
    expect(a.requests.find((x) => x.id === r)!.interactionId).toBeNull();
    expect(a.followups).toEqual([]);
  });
  it('활동 값 검사: 날짜 필수·시간 형식·종료는 시작보다 늦게·제목 필수·유형 기본값', () => {
    const a = emptyAssistant();
    const id = one(a);
    expect(addInteraction(a, id, { title: 'x', date: '' }, { now: NOW })).toEqual({ error: '날짜을(를) 입력해 주세요.' });
    expect(addInteraction(a, id, { title: ' ', date: T }, { now: NOW })).toEqual({ error: '제목을 입력해 주세요.' });
    expect(addInteraction(a, id, { title: 'x', date: T, time: '9:5' }, { now: NOW })).toEqual({ error: '시간 형식이 올바르지 않습니다. (예: 14:30)' });
    expect(addInteraction(a, id, { title: 'x', date: T, time: '15:00', endTime: '14:00' }, { now: NOW })).toEqual({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    expect(addInteraction(a, 'CU-999', { title: 'x', date: T }, { now: NOW })).toEqual({ error: '고객을 찾을 수 없습니다.' });
    const i = ok(addInteraction(a, id, { title: 'x', date: T, type: '이상한유형' }, { now: NOW })).id;
    expect(a.interactions.find((x) => x.id === i)!.type).toBe('기타');
    const j = ok(addInteraction(a, id, { title: 'y', date: T }, { now: NOW })).id;
    expect(a.interactions.find((x) => x.id === j)!.type).toBe('메모');
    // 고칠 때 종료 시간은 기존 시작 시간과 견준다
    const k = ok(addInteraction(a, id, { title: 'z', date: T, time: '15:00' }, { now: NOW })).id;
    expect(updateInteraction(a, k, { endTime: '14:00' }, NOW)).toEqual({ error: '종료 시간은 시작 시간보다 늦어야 합니다.' });
    expect(isErr(updateInteraction(a, k, { endTime: '16:00' }, NOW))).toBe(false);
  });
});

describe('요청사항·기념일', () => {
  it('요청: 내용 필수·접수일 기본 오늘·상태 검사·수정·삭제', () => {
    const a = emptyAssistant();
    const id = one(a);
    expect(addRequest(a, id, { content: ' ' }, { now: NOW })).toEqual({ error: '요청 내용을 입력해 주세요.' });
    expect(addRequest(a, id, { content: 'x', status: '없는상태' }, { now: NOW })).toEqual({ error: '진행상태 값이 올바르지 않습니다.' });
    expect(addRequest(a, id, { content: 'x', dueDate: '2026-02-30' }, { now: NOW })).toEqual({ error: '처리기한이(가) 존재하지 않는 날짜입니다.' });
    const r = ok(addRequest(a, id, { content: '자료 전달', dueDate: '2026-11-05' }, { now: NOW })).id;
    expect(a.requests[0]).toMatchObject({ receivedDate: T, status: '미착수', source: 'manual', interactionId: null });
    ok(updateRequest(a, r, { status: '완료', result: '송부' }, new Date(2026, 9, 31, 8, 0, 0)));
    expect(a.requests[0]).toMatchObject({ status: '완료', result: '송부', updatedAt: '2026-10-31 08:00:00' });
    expect(updateRequest(a, 'RQ-999', { status: '완료' }, NOW)).toEqual({ error: '요청사항을 찾을 수 없습니다.' });
    ok(deleteRequest(a, r));
    expect(a.requests).toEqual([]);
  });
  it('기념일: 날짜 필수·종류 기본값·알림 시점 정리·수정·삭제', () => {
    const a = emptyAssistant();
    const id = one(a);
    expect(addAnniversary(a, id, { date: '' }, { now: NOW })).toEqual({ error: '날짜을(를) 입력해 주세요.' });
    const x = ok(addAnniversary(a, id, { date: '2010-05-05', kind: '엉뚱한', remindDays: '30, 7, abc, 99, 0' }, { now: NOW })).id;
    expect(a.anniversaries[0]).toMatchObject({ kind: '기타 기념일', repeatYearly: true, remindDays: '30,7,0' });
    expect(cleanRemindDays('')).toBe('7,2,0');
    ok(updateAnniversary(a, x, { repeatYearly: false, label: '창립', notes: '메모' }));
    expect(a.anniversaries[0]).toMatchObject({ repeatYearly: false, label: '창립', notes: '메모' });
    ok(deleteAnniversary(a, x));
    expect(a.anniversaries).toEqual([]);
  });
});

describe('날짜 도우미', () => {
  it('달력 검사·다음 도래일(2/29는 평년 2/28)', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(nextOccurrence('1990-10-30', '2026-10-30')).toBe('2026-10-30');
    expect(nextOccurrence('1990-10-29', '2026-10-30')).toBe('2027-10-29');
    expect(nextOccurrence('2000-02-29', '2026-10-30')).toBe('2027-02-28');
    expect(nextOccurrence('2000-02-29', '2027-10-30')).toBe('2028-02-29');
    expect(nextOccurrence('12-25', '2026-10-30')).toBe('2026-12-25');
    expect(nextOccurrence('엉뚱', '2026-10-30')).toBeNull();
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('파이썬 round처럼 .5는 짝수 쪽으로', () => {
    expect([0.5, 1.5, 2.5, 3.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 4, 2, 3]);
  });
});
