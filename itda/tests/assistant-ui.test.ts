// AI 비서 화면 보조 로직(src/assistant/ui/logic.ts) 시험 — 글자 강조, D-day 표시, 담당 영업자 변경 범위, 가상 데이터 삭제·복원, 미팅 후 질문 답 편집, 이동 경로.
// 화면(React)은 점검 20(브라우저)이 확인한다. 가상 데이터만 쓴다.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { canEditCustomer, createCustomer, isErr } from '../src/assistant/model';
import {
  avatarTone,
  canChangeOwner,
  changedKeys,
  clearAnswer,
  customerPath,
  ddayLabel,
  ddayTone,
  deletableIds,
  deleteCustomers,
  emptyForm,
  evidencePath,
  followupPath,
  formOf,
  highlightParts,
  initialOf,
  noticePath,
  ownerChoices,
  ownerLabel,
  pickOption,
  restoreDemo,
  setAnswerInput,
  setCustomerOwner,
} from '../src/assistant/ui/logic';
import { flatten, quickFind } from '../src/lib/quickFind';
import type { AppState } from '../src/lib/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0);
const seed = (): AppState => createSeed('linked', NOW);

describe('표시 보조', () => {
  it('머리글자: 첫 글자, 비면 ?', () => {
    expect(initialOf('김도현')).toBe('김');
    expect(initialOf('  Ann ')).toBe('A');
    expect(initialOf('')).toBe('?');
  });
  it('아바타 색은 같은 ID면 늘 같고 0~5 안', () => {
    for (const id of ['CU-001', 'CU-018', '', 'x']) {
      expect(avatarTone(id)).toBe(avatarTone(id));
      expect(avatarTone(id)).toBeGreaterThanOrEqual(0);
      expect(avatarTone(id)).toBeLessThan(6);
    }
  });
  it('D-day 글과 색', () => {
    expect(ddayLabel(0)).toBe('오늘');
    expect(ddayLabel(3)).toBe('D-3');
    expect(ddayLabel(-2)).toBe('2일 경과');
    expect(ddayLabel(null)).toBe('');
    expect(ddayTone(-1)).toBe('danger');
    expect(ddayTone(0)).toBe('danger');
    expect(ddayTone(3)).toBe('warn');
    expect(ddayTone(10)).toBe('muted');
    expect(ddayTone(null)).toBe('muted');
  });
});

describe('highlightParts', () => {
  const join = (p: { text: string }[]) => p.map((x) => x.text).join('');
  it('키워드가 없으면 한 조각, 글은 그대로', () => {
    expect(highlightParts('해산물, 매운 음식', [])).toEqual([{ text: '해산물, 매운 음식', hit: false }]);
    expect(highlightParts('', ['a'])).toEqual([{ text: '', hit: false }]);
  });
  it('맞는 곳만 칠하고 합치면 원문과 같다(대소문자 무시)', () => {
    const p = highlightParts('CMS 운영시간 확대, cms 설정', ['cms']);
    expect(p.filter((x) => x.hit).map((x) => x.text)).toEqual(['CMS', 'cms']);
    expect(join(p)).toBe('CMS 운영시간 확대, cms 설정');
  });
  it('겹치는 키워드는 하나로 합친다', () => {
    const p = highlightParts('운영시간 확대', ['운영시', '영시간']);
    expect(p.filter((x) => x.hit).map((x) => x.text)).toEqual(['운영시간']);
  });
  it('정규식 특수문자·빈 키워드·공백 키워드에도 안전', () => {
    expect(join(highlightParts('가격 (10%)+', ['(10%)', '', '  ', '+']))).toBe('가격 (10%)+');
    expect(highlightParts('가격 (10%)+', ['(10%)', '+']).filter((x) => x.hit).map((x) => x.text)).toEqual(['(10%)+']);
    expect(highlightParts('abc', ['zzz'])).toEqual([{ text: 'abc', hit: false }]);
  });
});

describe('고객 양식', () => {
  it('formOf는 24칸 모두, emptyForm은 모두 빈 글', () => {
    const s = seed();
    const f = formOf(s.assistant!.customers[0]);
    expect(Object.keys(f)).toHaveLength(24);
    expect(f.name).toBe(s.assistant!.customers[0].name);
    expect(Object.values(emptyForm()).every((v) => v === '')).toBe(true);
  });
  it('changedKeys: 앞뒤 공백만 다른 칸은 바뀐 것이 아니다', () => {
    const base = emptyForm();
    const next = { ...base, name: ' 홍길동', foodLikes: '한식' };
    expect(changedKeys({ ...base, name: '홍길동' }, next)).toEqual(['foodLikes']);
  });
});

describe('담당 영업자 변경(조직장 범위)', () => {
  it('조직장(팀장 U3, 부장 U8)만 바꿀 수 있고 팀원(U1·U2)은 못 바꾼다', () => {
    const s = seed();
    const c = s.assistant!.customers[0]; // 담당 U1
    expect(canChangeOwner(s, 'U3', c.id)).toBe(true);
    expect(canChangeOwner(s, 'U8', c.id)).toBe(true);
    expect(canChangeOwner(s, 'U1', c.id)).toBe(false); // 담당 본인이지만 조직장이 아님
    expect(canChangeOwner(s, 'U2', c.id)).toBe(false);
    expect(canChangeOwner(s, 'U3', null)).toBe(true); // 새 고객 등록 때는 조직장이면 선택 가능
  });
  it('선택 목록: 지금 담당자 + 내 조직 범위의 재직자. 범위 밖 사람·전출 퇴직자는 빠진다', () => {
    const s = seed();
    const ids = ownerChoices(s, 'U3', 'U1').map((u) => u.id);
    expect(ids).toContain('U1');
    expect(ids).toContain('U2');
    expect(ids).toContain('U3');
    expect(ids).not.toContain('U5'); // 다른 팀(정산·결제팀)
    s.users.find((u) => u.id === 'U2')!.status = 'left';
    expect(ownerChoices(s, 'U3', 'U1').map((u) => u.id)).not.toContain('U2');
    // 지금 담당자가 전출·퇴직이어도 목록에는 남는다(현재 값 표시)
    s.users.find((u) => u.id === 'U1')!.status = 'left';
    expect(ownerChoices(s, 'U3', 'U1').map((u) => u.id)).toContain('U1');
  });
  it('setCustomerOwner: 범위 안이면 바꾸고, 범위 밖·권한 없음·같은 담당은 거부/무시', () => {
    const s = seed();
    const a = s.assistant!;
    const c = a.customers[0];
    expect(setCustomerOwner(s, a, c.id, 'U2', 'U3', NOW)).toEqual({ changed: true });
    expect(a.customers[0].ownerId).toBe('U2');
    expect(canEditCustomer(s, c.id, 'U1')).toBe(false); // 담당이 바뀌면 U1은 못 고친다
    expect(canEditCustomer(s, c.id, 'U2')).toBe(true);
    expect(setCustomerOwner(s, a, c.id, 'U2', 'U3', NOW)).toEqual({ changed: false });
    const r1 = setCustomerOwner(s, a, c.id, 'U5', 'U3', NOW); // 범위 밖 사람으로
    expect(isErr(r1)).toBe(true);
    const r2 = setCustomerOwner(s, a, c.id, 'U1', 'U2', NOW); // 팀원이 바꾸려 함
    expect(isErr(r2)).toBe(true);
    expect(a.customers[0].ownerId).toBe('U2');
    expect(isErr(setCustomerOwner(s, a, 'CU-999', 'U1', 'U3', NOW))).toBe(true);
  });
  it('ownerLabel: 전출·퇴직 표시, 없는 사람은 ID', () => {
    const s = seed();
    expect(ownerLabel(s, 'U1')).toBe('김도윤');
    s.users.find((u) => u.id === 'U1')!.status = 'left';
    expect(ownerLabel(s, 'U1')).toBe('김도윤 (전출·퇴직)');
    expect(ownerLabel(s, 'U404')).toBe('U404');
    expect(ownerLabel(s, '')).toBe('미지정');
  });
});

describe('가상 데이터 삭제·복원, 전체 삭제', () => {
  it('내가 고칠 수 있는 고객만 지운다(남의 고객은 남음). 가상만 지우면 직접 등록한 고객은 남는다', () => {
    const s = seed();
    const a = s.assistant!;
    const mine = createCustomer(a, { name: '직접등록', company: '내회사' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const others = createCustomer(a, { name: '남의고객', company: '남의회사' }, { now: NOW, ownerId: 'U5' }) as { id: string };
    expect(deletableIds(s, 'U1', 'demo')).toHaveLength(18);
    expect(deletableIds(s, 'U1', 'all')).toContain(mine.id);
    expect(deletableIds(s, 'U1', 'all')).not.toContain(others.id);
    const n = deleteCustomers(a, deletableIds(s, 'U1', 'demo'));
    expect(n).toBe(18);
    expect(a.customers.map((c) => c.id).sort()).toEqual([mine.id, others.id].sort());
    expect(a.interactions).toHaveLength(0);
    expect(a.requests).toHaveLength(0);
    expect(s.assistant).toBe(a); // 칸은 남는다 → 다시 채우지 않는다
  });
  it('전체 삭제 뒤에도 assistant 칸은 빈 데이터로 남아 migrate가 가상 고객을 다시 채우지 않는다', async () => {
    const { migrate } = await import('../src/lib/migrate');
    const s = seed();
    deleteCustomers(s.assistant!, deletableIds(s, 'U1', 'all'));
    expect(s.assistant!.customers).toHaveLength(0);
    expect(s.assistant!.noticeRead).toEqual([]);
    const again = migrate(JSON.parse(JSON.stringify(s)), NOW);
    expect(again.assistant!.customers).toHaveLength(0);
  });
  it('restoreDemo: 지운 가상 고객을 새 ID로 하위 기록과 함께 채우고, 두 번 하면 더 늘지 않는다', () => {
    const s = seed();
    const a = s.assistant!;
    const before = { c: a.customers.length, i: a.interactions.length, r: a.requests.length, n: a.anniversaries.length };
    deleteCustomers(a, deletableIds(s, 'U1', 'demo'));
    expect(restoreDemo(a, NOW, 'U1')).toBe(18);
    expect({ c: a.customers.length, i: a.interactions.length, r: a.requests.length, n: a.anniversaries.length }).toEqual(before);
    const ids = a.customers.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 요청이 가리키는 활동은 새 ID 안에 있다
    const iids = new Set(a.interactions.map((i) => i.id));
    for (const r of a.requests) if (r.interactionId) expect(iids.has(r.interactionId)).toBe(true);
    for (const r of a.requests) expect(ids).toContain(r.customerId);
    expect(restoreDemo(a, NOW, 'U1')).toBe(0);
    expect(a.customers).toHaveLength(18);
  });
  it('restoreDemo는 일부만 남아 있으면 없는 고객만 채운다(이름+소속이 같으면 건너뜀)', () => {
    const s = seed();
    const a = s.assistant!;
    const keep = a.customers.slice(0, 5).map((c) => c.id);
    deleteCustomers(a, a.customers.filter((c) => !keep.includes(c.id)).map((c) => c.id));
    expect(a.customers).toHaveLength(5);
    expect(restoreDemo(a, NOW, 'U2')).toBe(13);
    expect(a.customers).toHaveLength(18);
    expect(a.customers.filter((c) => c.ownerId === 'U2')).toHaveLength(13); // 새로 채운 것의 담당은 지금 사용자
  });
});

describe('미팅 후 질문 답 편집', () => {
  it('선택지를 고르면 입력은 비고, 같은 값을 다시 고르면 그대로', () => {
    let a = pickOption({}, 'request', '자료 요청');
    expect(a).toEqual({ request: { value: '자료 요청' } });
    a = setAnswerInput(a, 'request', 'content', 'CMS 자료');
    expect(a.request).toEqual({ value: '자료 요청', content: 'CMS 자료' });
    expect(pickOption(a, 'request', '자료 요청')).toBe(a);
    const b = pickOption(a, 'request', 'none');
    expect(b.request).toEqual({ value: 'none' }); // 이전 입력은 지운다
  });
  it('고른 선택지가 없으면 입력은 무시, 건너뛰기는 답을 지운다', () => {
    const a0 = {};
    expect(setAnswerInput(a0, 'held', 'new_date', '2026-11-01')).toBe(a0);
    const a1 = pickOption({}, 'held', 'moved');
    const a2 = clearAnswer(a1, 'held');
    expect(a2).toEqual({});
    expect(clearAnswer(a2, 'held')).toBe(a2);
    expect(a1.held).toBeDefined(); // 원본은 바뀌지 않는다
  });
});

describe('이동 경로', () => {
  it('고객·질문·알림·근거', () => {
    expect(customerPath('CU-001')).toBe('/assistant/customers/CU-001');
    expect(customerPath('CU-001', 'overview')).toBe('/assistant/customers/CU-001');
    expect(customerPath('CU-001', 'changes')).toBe('/assistant/customers/CU-001?tab=changes');
    expect(followupPath('IA-007')).toBe('/assistant/followup/IA-007');
    expect(noticePath({ to: 'customer-requests', customerId: 'CU-002' })).toBe('/assistant/customers/CU-002?tab=requests');
    expect(noticePath({ to: 'customer-events', customerId: 'CU-002' })).toBe('/assistant/customers/CU-002?tab=events');
    expect(noticePath({ to: 'briefing', customerId: 'CU-002', interactionId: 'IA-003' })).toBe('/assistant/customers/CU-002?briefing=IA-003');
    expect(noticePath({ to: 'briefing', customerId: 'CU-002' })).toBe('/assistant/customers/CU-002?briefing=1');
    expect(noticePath({ to: 'followup', customerId: 'CU-002', interactionId: 'IA-003' })).toBe('/assistant/followup/IA-003');
    expect(noticePath({ to: 'followup', customerId: 'CU-002' })).toBe('/assistant/customers/CU-002?tab=history');
    expect(evidencePath({ to: 'customer-history', customerId: 'CU-003' })).toBe('/assistant/customers/CU-003?tab=history');
    expect(evidencePath({ to: 'customer-requests', customerId: 'CU-003' })).toBe('/assistant/customers/CU-003?tab=requests');
    expect(evidencePath({ to: 'customer-events', customerId: 'CU-003' })).toBe('/assistant/customers/CU-003?tab=events');
  });
});

describe('바로 찾기(Ctrl+K)에 AI 비서', () => {
  it('메뉴 「AI 비서」: 이름·별칭·초성으로 찾는다', () => {
    const s = seed();
    for (const q of ['AI 비서', '비서', '고객관리', 'ㅂㅅ']) {
      const hit = flatten(quickFind(s, q)).find((i) => i.kind === 'menu' && i.to === '/assistant');
      expect(hit?.title, q).toBe('AI 비서');
    }
  });
  it('기능 「고객 추가」: 초성(ㄱㄱㅊㄱ)·별칭으로 찾고 고객 등록 창이 열리는 주소로 간다', () => {
    const s = seed();
    for (const q of ['고객 추가', 'ㄱㄱㅊㄱ', '신규 고객']) {
      const hit = flatten(quickFind(s, q)).find((i) => i.kind === 'action' && i.title === '고객 추가');
      expect(hit?.to, q).toBe('/assistant/customers?new=1');
    }
  });
  it('빈 검색어에서는 메뉴 10개·기능 9개가 모두 나온다(항목 수 상한이 새 항목 때문에 잘리지 않음)', () => {
    const g = quickFind(seed(), '');
    expect(g.find((x) => x.kind === 'menu')!.items).toHaveLength(10);
    expect(g.find((x) => x.kind === 'action')!.items).toHaveLength(9);
  });
});
