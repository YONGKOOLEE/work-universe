// 미팅 후 질문 원칙: 30일 재질문 안 함, 먹은 음식은 선호로 저장 안 함, 체크한 것만 반영, 사적 질문 없음, 연기·취소·건너뛰기. 가상 데이터만.
import { describe, expect, it } from 'vitest';
import { createAssistantSeed } from '../src/assistant/seed';
import { addInteraction, createCustomer, isErr } from '../src/assistant/model';
import { applyFollowup, buildQuestions, fireTime, meetingError, MAX_QUESTIONS, NEED_NEW_DATE, pending, proposals, setState, skipFollowup } from '../src/assistant/followup';
import type { AssistantData } from '../src/assistant/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0);
const at = (y: number, m: number, d: number, h = 10, mi = 0) => new Date(y, m - 1, d, h, mi, 0);

/** 정보가 거의 없는 고객 + 어제 미팅 하나 */
function bare(): { a: AssistantData; cid: string; mid: string } {
  const a = createAssistantSeed(NOW, 'U1');
  const r = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
  const m = addInteraction(a, r.id, { type: '미팅', date: '2026-10-29', time: '14:00', title: '시험 미팅' }, { now: NOW }) as { id: string };
  return { a, cid: r.id, mid: m.id };
}
const ids = (a: AssistantData, mid: string, now = NOW) => buildQuestions(a, mid, now)!.questions.map((q) => q.id);
const cust = (a: AssistantData, cid: string) => a.customers.find((c) => c.id === cid)!;

describe('질문 만들기', () => {
  it('항상 「진행 여부」「새 요청」 두 개가 먼저, 전체 최대 5개', () => {
    const { a, mid } = bare();
    const q = ids(a, mid);
    expect(q.slice(0, 2)).toEqual(['held', 'request']);
    expect(q.length).toBe(MAX_QUESTIONS);
    expect(q).toEqual(['held', 'request', 'food_ate', 'food_pref', 'interest']);
  });
  it('이미 아는 정보는 묻지 않는다(채우면 질문이 줄어든다)', () => {
    const { a, cid, mid } = bare();
    Object.assign(cust(a, cid), { foodLikes: '한식', recentInterests: '골프', nextContactDate: '2026-12-01', personality: '꼼꼼함', contactPreference: '이메일', department: '영업부', position: '과장' });
    expect(ids(a, mid)).toEqual(['held', 'request']);
  });
  it('가족·건강 같은 사적인 질문은 만들지 않는다(「가족·생활」 선택지 없음)', () => {
    const { a, mid } = bare();
    const all = JSON.stringify(buildQuestions(a, mid, NOW)!.questions);
    expect(all).not.toContain('가족');
    expect(all).not.toContain('건강');
    expect(all).not.toContain('생년월일');
  });
  it('오래된 정보(관심 주제 90일)는 「여전히 맞나요?」로 다시 확인한다 — 이력이 있을 때만', () => {
    const { a, cid, mid } = bare();
    Object.assign(cust(a, cid), { foodLikes: '한식', recentInterests: '골프', nextContactDate: '2026-12-01', personality: 'x', contactPreference: 'y', department: 'd', position: 'p' });
    expect(ids(a, mid)).toEqual(['held', 'request']); // 이력이 없으면(데모 고객 포함) 나이를 알 수 없어 묻지 않는다
    a.changes.push({ id: 'CH-900', customerId: cid, field: 'recentInterests', oldValue: '', newValue: '골프', source: 'manual', note: '', changedAt: '2026-06-01 09:00:00' });
    const q = buildQuestions(a, mid, NOW)!.questions;
    const stale = q.find((x) => x.id === 'stale_recentInterests')!;
    expect(stale.text).toContain("'골프'");
    expect(stale.reason).toContain('일 전 정보');
  });
});

describe('「언급 없음」 30일 재질문 안 함', () => {
  it('답한 뒤 30일 안에는 같은 질문을 만들지 않고, 31일째에는 다시 묻는다', () => {
    const { a, cid, mid } = bare();
    expect(ids(a, mid)).toContain('food_pref');
    const r = applyFollowup(a, mid, { held: { value: 'yes' }, food_pref: { value: 'none' }, interest: { value: 'unknown' } }, [], NOW);
    expect(isErr(r)).toBe(false);
    // 다른 미팅(오늘 아침)에서 같은 고객에게 다시 질문을 만들 때
    const m2 = (addInteraction(a, cid, { type: '미팅', date: '2026-10-30', time: '08:00', title: '두 번째' }, { now: NOW }) as { id: string }).id;
    const soon = ids(a, m2, at(2026, 11, 20)); // 21일 뒤
    expect(soon).not.toContain('food_pref');
    const much = ids(a, m2, at(2026, 12, 1)); // 32일 뒤
    expect(much).toContain('food_pref');
  });
  it('「있었음」 같은 실제 답은 재질문 방지 대상이 아니다', () => {
    const { a, cid, mid } = bare();
    applyFollowup(a, mid, { held: { value: 'yes' }, food_pref: { value: 'like', like: '한식' } }, [], NOW);
    expect(cust(a, cid).foodLikes).toBe(''); // 체크하지 않았으므로 저장 안 됨
    const m2 = (addInteraction(a, cid, { type: '미팅', date: '2026-10-30', time: '08:00', title: '두 번째' }, { now: NOW }) as { id: string }).id;
    expect(ids(a, m2)).toContain('food_pref');
  });
});

describe('답변 → 반영안 → 체크한 것만 저장', () => {
  it('먹은 음식은 선호 음식으로 저장하지 않고 미팅 메모로만 남긴다', () => {
    const { a, mid } = bare();
    const p = proposals(a, mid, { food_ate: { value: '일식' } }, NOW)!.proposals;
    expect(p.map((x) => x.kind)).toEqual(['meeting_note']);
    expect(p[0].new).toContain('식사: 일식');
    expect(p.some((x) => x.field === 'foodLikes')).toBe(false);
  });
  it('체크한 항목만 저장하고, 안 한 항목은 저장하지 않는다', () => {
    const { a, cid, mid } = bare();
    const answers = { held: { value: 'yes' }, request: { value: '자료 요청', content: '이용 안내서 전달', due_date: '2026-11-05', assignee: '납기팀' }, food_pref: { value: 'both', like: '냉면', dislike: '고수' }, interest: { value: '취미·여가', text: '테니스' } };
    const p = proposals(a, mid, answers, NOW)!.proposals;
    expect(p.map((x) => x.kind)).toEqual(['request', 'field', 'field', 'field', 'meeting_note']); // 최근 미팅일은 활동을 더할 때 이미 올라가 있어 반영안이 없다
    // 요청(0)·선호 음식(1)만 체크
    const r = applyFollowup(a, mid, answers, [{ idx: 0, include: true }, { idx: 1, include: true }, { idx: 2, include: false }, { idx: 3, include: false }, { idx: 4, include: false }], NOW);
    expect(r).toMatchObject({ applied: 2, moved: false });
    expect(cust(a, cid)).toMatchObject({ foodLikes: '냉면', foodDislikes: '', hobbies: '' });
    expect(a.requests.filter((x) => x.customerId === cid).map((x) => ({ c: x.content, d: x.dueDate, s: x.source, i: x.interactionId }))).toEqual([{ c: '이용 안내서 전달', d: '2026-11-05', s: 'followup', i: mid }]);
    expect(a.changes.filter((x) => x.source === 'followup').map((x) => x.field)).toEqual(['foodLikes']);
    expect(a.interactions.find((i) => i.id === mid)!.details).toBe(''); // 메모는 체크하지 않았다
    expect(a.followups.find((f) => f.interactionId === mid)!.status).toBe('done');
  });
  it('수정한 값·기한이 반영되고, 잘못된 날짜면 아무것도 저장하지 않는다', () => {
    const { a, cid, mid } = bare();
    const answers = { request: { value: '기타', content: '문의 회신', due_date: '2026-11-05' }, food_pref: { value: 'like', like: '한식' } };
    const before = JSON.stringify(a);
    const bad = applyFollowup(a, mid, answers, [{ idx: 0, include: true, dueDate: '2026-02-30' }, { idx: 1, include: true }], NOW);
    expect(bad).toEqual({ error: '처리기한이(가) 존재하지 않는 날짜입니다.' });
    expect(JSON.stringify(a)).toBe(before);
    const good = applyFollowup(a, mid, answers, [{ idx: 0, include: true, new: '문의 회신 및 일정 안내', dueDate: '2026-11-09', assignee: '김담당' }, { idx: 1, include: true, new: '한식, 국밥' }], NOW);
    expect(isErr(good)).toBe(false);
    expect(a.requests.at(-1)).toMatchObject({ content: '문의 회신 및 일정 안내', dueDate: '2026-11-09', assignee: '김담당' });
    expect(cust(a, cid).foodLikes).toBe('한식, 국밥');
  });
  it('물어보지 않은 질문의 답은 무시한다(5개 제한 밖)', () => {
    const { a, mid } = bare();
    expect(ids(a, mid)).not.toContain('personality');
    expect(proposals(a, mid, { personality: { value: 'etc', text: '꼼꼼' } }, NOW)!.proposals).toEqual([]);
  });
  it('목록 항목(취미)은 기존 값 뒤에 이어 붙이고, 이미 들어 있는 값은 반영안이 없다', () => {
    const { a, cid, mid } = bare();
    cust(a, cid).hobbies = '골프';
    const p = proposals(a, mid, { interest: { value: '취미·여가', text: '등산' } }, NOW)!.proposals;
    expect(p[0]).toMatchObject({ kind: 'field', field: 'hobbies', old: '골프', new: '골프, 등산', mode: 'append' });
    expect(proposals(a, mid, { interest: { value: '취미·여가', text: '골프' } }, NOW)!.proposals.filter((x) => x.kind === 'field')).toEqual([]);
    applyFollowup(a, mid, { interest: { value: '취미·여가', text: '등산' } }, [{ idx: 0, include: true }], NOW);
    expect(cust(a, cid).hobbies).toBe('골프, 등산');
  });
  it('단일 항목(다음 연락일)은 바꾸고, 음식 정보가 하나라도 있으면 음식 질문은 나오지 않는다', () => {
    const { a, cid, mid } = bare();
    const p = proposals(a, mid, { next_contact: { value: 'set', date: '2026-11-20' } }, NOW)!;
    expect(p.info.questions.map((q) => q.id)).not.toContain('next_contact'); // 5개 제한 안에 없으면 무시
    cust(a, cid).foodDislikes = '매운 음식';
    expect(ids(a, mid)).not.toContain('food_pref');
    expect(ids(a, mid)).toContain('next_contact');
    const q = proposals(a, mid, { next_contact: { value: 'set', date: '2026-11-20' } }, NOW)!.proposals;
    expect(q[0]).toMatchObject({ field: 'nextContactDate', new: '2026-11-20', mode: 'replace' });
  });
});

describe('연기·취소·건너뛰기·질문 시각', () => {
  it('연기: 미팅 날짜가 바뀌고 질문 상태를 지운다(새 날짜에 다시 묻는다), 최근 미팅일은 다시 계산', () => {
    const { a, cid, mid } = bare();
    a.followups.push({ interactionId: mid, status: 'pending', answers: {}, asked: [], updatedAt: '2026-10-29 10:00:00' });
    const r = applyFollowup(a, mid, { held: { value: 'moved', new_date: '2026-11-12' } }, [{ idx: 0, include: true }], NOW);
    expect(r).toMatchObject({ moved: true, applied: 1 });
    expect(a.interactions.find((i) => i.id === mid)!.date).toBe('2026-11-12');
    expect(a.followups.find((f) => f.interactionId === mid)).toBeUndefined();
    expect(cust(a, cid).lastMeetingDate).toBe('');
  });
  it('연기인데 날짜가 없으면 취소로 바꾸지 않고 날짜 입력을 안내한다(검토 7). 취소는 활동 유형을 메모로 바꾼다', () => {
    const { a, mid } = bare();
    const r0 = proposals(a, mid, { held: { value: 'moved' } }, NOW)!;
    expect(r0.proposals).toEqual([]); // 예전에는 여기서 「취소」 반영안이 나와 미팅이 취소로 처리됐다
    expect(r0.problems).toEqual([{ qid: 'held', text: NEED_NEW_DATE, blocking: true }]);
    const before = JSON.stringify(a);
    expect(applyFollowup(a, mid, { held: { value: 'moved' } }, [{ idx: 0, include: true }], NOW)).toEqual({ error: NEED_NEW_DATE });
    expect(JSON.stringify(a)).toBe(before); // 아무것도 저장하지 않는다
    // 공백뿐인 날짜도 같다
    expect(proposals(a, mid, { held: { value: 'moved', new_date: '  ' } }, NOW)!.problems.map((p) => p.blocking)).toEqual([true]);
    const p = proposals(a, mid, { held: { value: 'cancel' } }, NOW)!.proposals;
    expect(p.map((x) => x.kind)).toEqual(['meeting_cancel']);
    applyFollowup(a, mid, { held: { value: 'cancel' } }, [{ idx: 0, include: true }], NOW);
    const m = a.interactions.find((i) => i.id === mid)!;
    expect(m).toMatchObject({ type: '메모', title: '[취소] 시험 미팅' });
  });
  it('진행됨: 최근 미팅일·연락일을 올린다(체크했을 때만)', () => {
    const { a, cid, mid } = bare();
    const answers = { held: { value: 'yes' } };
    applyFollowup(a, mid, answers, [], NOW);
    expect(cust(a, cid).lastMeetingDate).toBe('2026-10-29'); // 이미 활동 추가 때 올라가 있다
    expect(proposals(a, mid, answers, NOW)!.proposals).toEqual([]); // 이미 같은 날짜면 반영안 없음
  });
  it('건너뛰기 → 대기 목록에서 빠진다', () => {
    const { a, mid } = bare();
    expect(pending(a, NOW).some((m) => m.id === mid)).toBe(true);
    expect(skipFollowup(a, mid, NOW)).toEqual({ ok: true });
    expect(pending(a, NOW).some((m) => m.id === mid)).toBe(false);
    setState(a, mid, 'pending', NOW);
    expect(pending(a, NOW).some((m) => m.id === mid)).toBe(true);
  });
  it('아직 진행되지 않은 미팅·미팅이 아닌 기록·없는 기록은 거절', () => {
    const { a, cid } = bare();
    const future = (addInteraction(a, cid, { type: '미팅', date: '2026-11-03', title: '예정' }, { now: NOW }) as { id: string }).id;
    const call = (addInteraction(a, cid, { type: '통화', date: '2026-10-29', title: '통화' }, { now: NOW }) as { id: string }).id;
    expect(meetingError(a, future, NOW)).toContain('아직 진행되지 않은 미팅');
    expect(meetingError(a, call, NOW)).toContain('미팅 기록에만');
    expect(meetingError(a, 'IA-999', NOW)).toContain('찾을 수 없습니다');
    expect(isErr(applyFollowup(a, future, {}, [], NOW))).toBe(true);
    expect(isErr(skipFollowup(a, call, NOW))).toBe(true);
  });
  it('질문 시각: 종료 시간 +1시간, 시작+소요시간(60분 기본)+1시간, 시간 없으면 18:00, 설정 반영', () => {
    const conf = { fuDuration: 60, fuNotime: '18:00' };
    expect(fireTime({ date: '2026-10-29', time: '14:00', endTime: '15:30' }, conf)).toBe('2026-10-29 16:30:00');
    expect(fireTime({ date: '2026-10-29', time: '14:00', endTime: '' }, conf)).toBe('2026-10-29 16:00:00');
    expect(fireTime({ date: '2026-10-29', time: '23:30', endTime: '' }, conf)).toBe('2026-10-30 01:30:00');
    expect(fireTime({ date: '2026-10-29', time: '', endTime: '' }, conf)).toBe('2026-10-29 18:00:00');
    expect(fireTime({ date: '2026-10-29', time: '14:00', endTime: '' }, { fuDuration: 120, fuNotime: '20:00' })).toBe('2026-10-29 17:00:00');
    expect(fireTime({ date: '2026-10-29', time: '', endTime: '' }, { fuDuration: 60, fuNotime: '20:00' })).toBe('2026-10-29 20:00:00');
  });
  it('질문 시각이 지나기 전에는 대기 목록에 없고, 미팅 후 3일이 지나면 빠진다', () => {
    const { a, mid } = bare();
    expect(pending(a, at(2026, 10, 30, 0, 0)).some((m) => m.id === mid)).toBe(true); // 어제 16:00 → 오늘 0시에는 이미 지남
    expect(pending(a, at(2026, 10, 29, 14, 30)).some((m) => m.id === mid)).toBe(false); // 아직 16:00 전
    expect(pending(a, at(2026, 11, 2, 10, 0)).some((m) => m.id === mid)).toBe(false); // 4일 지남
  });
});
