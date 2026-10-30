// 재검증(2026-10-30) 지적 중 대화 분석 인용·승인 경고·최근 연락일·미팅 후 질문·불러오기·작은 것들의 회귀 시험. 가상 데이터만.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { parseBackup } from '../src/lib/store';
import { applyMerge, ownerStaysInFile, replaceCustomerInfo, replaceKeepingOtherMemos, replaceMoveTarget, sameCustomer, skippedDemoCustomers } from '../src/lib/mergeImport';
import type { AppState } from '../src/lib/types';
import { createAssistantSeed } from '../src/assistant/seed';
import { appendToList, listHas } from '../src/assistant/lists';
import { addInteraction, createCustomer, deleteInteraction, isErr, updateCustomer, updateInteraction } from '../src/assistant/model';
import { applyDraft, enrichDraft, maskText, verifyQuote, type Draft, type DraftItem, type EnrichedDraft } from '../src/assistant/claude';
import { applyFollowup, buildQuestions, proposals } from '../src/assistant/followup';
import type { AssistantData, Customer } from '../src/assistant/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0); // 2026-10-30 10:00
const seedA = () => createAssistantSeed(NOW, 'U1');
const cust = (a: AssistantData, name: string) => a.customers.find((c) => c.name === name)!;
const byId = (a: AssistantData, id: string) => a.customers.find((c) => c.id === id)!;

// ───────────── 4. 인용 대조 ─────────────
describe('재검증 4: 인용 대조 — 근거 전체를 먼저 대조하고, 말머리 표기 차이는 본문으로', () => {
  const Q = '음... 저는 해산물을 못 먹습니다.';
  it('원문에 말줄임표가 있는 인용은 나누지 않고 전체로 통과한다', () => {
    expect(verifyQuote(Q, `나: 안녕하세요.\n김도현: ${Q}`).ok).toBe(true);
    expect(verifyQuote(Q, `나: 안녕하세요.\n김도현: ${Q}`).span).toContain('음... 저는');
  });
  it('끝 마침표 차이는 무시한다(양쪽 방향)', () => {
    expect(verifyQuote('저는 해산물을 못 먹습니다', `김도현: ${Q}`).ok).toBe(true);
    expect(verifyQuote(Q, '김도현: 음... 저는 해산물을 못 먹습니다').ok).toBe(true);
  });
  it.each([
    ['[김도현] 음... 저는 해산물을 못 먹습니다.'],
    ['김도현 부장: 음... 저는 해산물을 못 먹습니다.'],
    ['김도현:음... 저는 해산물을 못 먹습니다.'],
  ])('원문 말머리 표기가 달라도(%s) 「김도현: …」 인용은 본문이 있으면 통과', (src) => {
    expect(verifyQuote(`김도현: ${Q}`, `나: 안녕하세요.\n${src}`).ok).toBe(true);
  });
  it('말머리 없는 원문(말머리가 하나도 없는 글)에서도 본문이 있으면 통과', () => {
    expect(verifyQuote(`김도현: ${Q}`, `안녕하세요.\n${Q}`).ok).toBe(true);
    expect(verifyQuote(`김도현: ${Q}`, Q).ok).toBe(true);
    expect(verifyQuote(`김도현: ${Q}`, '안녕하세요. 다른 말만 했습니다.').ok).toBe(false);
  });
  it('나:/영업사원 줄의 말을 고객 말로 인용하면 계속 실패한다', () => {
    const src = '나: 저는 요즘 회를 좋아해서요.\n김도현: 아, 저는 회는 별로고 고기가 좋아요.';
    expect(verifyQuote('김도현: 저는 요즘 회를 좋아해서요.', src).ok).toBe(false);
    expect(verifyQuote('김도현: 저는 요즘 회를 좋아해서요', src).ok).toBe(false); // 마침표 없이도
    const bracket = '[나] 저는 요즘 회를 좋아해서요.\n[김도현] 아, 저는 회는 별로고 고기가 좋아요.';
    expect(verifyQuote('김도현: 저는 요즘 회를 좋아해서요.', bracket).ok).toBe(false);
    expect(verifyQuote('고객: 저는 회는 별로고 고기가 좋아요.', src).ok).toBe(false);
  });
  it('말줄임 조각 순서·없는 말은 그대로 실패', () => {
    const src = '김도현: 주말마다 테니스를 배우느라 정신이 없어요. 그리고 출금 재시도 기능에 관심이 많아요.';
    expect(verifyQuote('주말마다 테니스를 배우느라 ... 출금 재시도 기능에 관심이', src).ok).toBe(true);
    expect(verifyQuote('출금 재시도 기능에 관심이 ... 주말마다 테니스를 배우느라', src).ok).toBe(false);
    expect(verifyQuote('요즘 골프를 시작해서 즐겁습니다', src).ok).toBe(false);
  });
});

// ───────────── 6. 승인 항목 값 경고 ─────────────
describe('재검증 6: 형식에 맞지 않는 값은 미리 경고하고 기본 해제 — 체크하면 지금처럼 오류', () => {
  const item = (over: Partial<DraftItem>): DraftItem => ({ kind: 'profile', evidence: '근거 문장 열두 글자 이상입니다', speaker: 'customer', confidence: 'high', isSpeculation: false, quoteVerified: true, ...over }) as DraftItem;
  const draft = (a: AssistantData, items: DraftItem[]): Draft => ({
    kind: 'ai', customerId: cust(a, '박준혁').id, filename: '', original: '', sentText: '', createdAt: '2026-10-30', title: '시험', interactionType: '통화', interactionDate: '2026-10-30', summary: '', speakerNote: '', items,
  });
  const items = [
    item({ field: 'birthDate', fieldLabel: '생년월일', value: '5월 3일' }),
    item({ field: 'birthDate', fieldLabel: '생년월일', value: '2099-01-01' }),
    item({ field: 'email', fieldLabel: '이메일', value: '잘못된메일' }),
    item({ field: 'nextContactDate', fieldLabel: '다음 연락·미팅 예정일', value: '2026-13-40' }),
    item({ field: 'birthDate', fieldLabel: '생년월일', value: '1980-05-03' }), // 정상
    item({ field: 'hobbies', fieldLabel: '취미·관심사', value: '낚시' }), // 정상
  ];
  it('잘못된 값 4건에는 「값 확인 필요」 경고와 기본 해제, 정상 2건은 그대로 선택', () => {
    const a = seedA();
    const e = enrichDraft(a, draft(a, items), NOW) as EnrichedDraft;
    expect(e.items.map((i) => i.include)).toEqual([false, false, false, false, true, true]);
    for (const i of e.items.slice(0, 4)) expect(i.warnings.some((w) => w.startsWith('값 확인 필요: '))).toBe(true);
    expect(e.items[0].warnings.join()).toContain('형식이 올바르지 않습니다');
    expect(e.items[1].warnings.join()).toContain('오늘 이후 날짜로 입력할 수 없습니다');
    expect(e.items[2].warnings.join()).toContain('이메일 형식');
    expect(e.items[4].warnings).toEqual([]);
  });
  it('사용자가 체크하면 지금처럼 오류가 나고 아무것도 저장되지 않는다', () => {
    const a = seedA();
    const d = draft(a, items);
    const before = JSON.stringify(a);
    for (const idx of [0, 1, 2, 3]) {
      const r = applyDraft(a, d, [{ idx, include: true }], {}, NOW);
      expect(isErr(r)).toBe(true);
    }
    expect(JSON.stringify(a)).toBe(before);
    expect(isErr(applyDraft(a, d, [{ idx: 4, include: true }, { idx: 5, include: true }], {}, NOW))).toBe(false);
  });
  it('추측 항목은 값 검사를 하지 않는다(확정 사실로 저장하지 않으므로)', () => {
    const a = seedA();
    const e = enrichDraft(a, draft(a, [item({ field: 'birthDate', fieldLabel: '생년월일', value: '5월 3일쯤', isSpeculation: true })]), NOW) as EnrichedDraft;
    expect(e.items[0].warnings.some((w) => w.startsWith('값 확인 필요'))).toBe(false);
  });
});

// ───────────── 5. 최근 연락일·미팅일 ─────────────
describe('재검증 5: 메모를 지우거나 옮겨도 직접 입력한 최근 연락일은 그대로 — 유형별로 다시 계산', () => {
  function setup() {
    const a = seedA();
    const c = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    // 직접 입력한 최근 연락일 = 메모 날짜와 우연히 같다
    const memo = addInteraction(a, c.id, { type: '메모', date: '2026-10-20', title: '메모' }, { now: NOW }) as { id: string };
    updateCustomer(a, c.id, { lastContactDate: '2026-10-20', lastMeetingDate: '2026-10-20' }, { now: NOW });
    return { a, cid: c.id, memo: memo.id };
  }
  it('메모를 지워도 최근 연락일·미팅일이 빈 값이 되지 않는다', () => {
    const { a, cid, memo } = setup();
    expect(deleteInteraction(a, memo, NOW)).toEqual({ ok: true });
    expect(byId(a, cid).lastContactDate).toBe('2026-10-20');
    expect(byId(a, cid).lastMeetingDate).toBe('2026-10-20');
  });
  it('메모의 날짜를 옮겨도 그대로', () => {
    const { a, cid, memo } = setup();
    updateInteraction(a, memo, { date: '2026-10-22' }, NOW);
    expect(byId(a, cid).lastContactDate).toBe('2026-10-20');
    expect(byId(a, cid).lastMeetingDate).toBe('2026-10-20');
  });
  it('통화를 지우면 최근 연락일만 다시 계산하고, 직접 입력한 최근 미팅일은 건드리지 않는다', () => {
    const { a, cid } = setup();
    const call = addInteraction(a, cid, { type: '통화', date: '2026-10-20', title: '통화' }, { now: NOW }) as { id: string };
    deleteInteraction(a, call.id, NOW);
    expect(byId(a, cid).lastContactDate).toBe(''); // 지운 통화의 날짜가 최근 연락일이었으므로 다시 계산 → 남은 연락 기록 없음
    expect(byId(a, cid).lastMeetingDate).toBe('2026-10-20'); // 통화는 미팅이 아니므로 최근 미팅일은 그대로
  });
  it('미팅을 지우면 최근 연락일·미팅일 모두 다시 계산한다(미팅은 연락 유형이므로)', () => {
    const a = seedA();
    const c = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const call = addInteraction(a, c.id, { type: '통화', date: '2026-10-01', title: '통화' }, { now: NOW }) as { id: string };
    const m = addInteraction(a, c.id, { type: '미팅', date: '2026-10-10', title: '미팅' }, { now: NOW }) as { id: string };
    expect(byId(a, c.id).lastContactDate).toBe('2026-10-10');
    deleteInteraction(a, m.id, NOW);
    expect(byId(a, c.id).lastContactDate).toBe('2026-10-01');
    expect(byId(a, c.id).lastMeetingDate).toBe('');
    expect(call.id).toBeTruthy();
  });
  it('유형을 미팅 → 메모로 바꾸면 최근 미팅일을 다시 계산한다', () => {
    const a = seedA();
    const c = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const m = addInteraction(a, c.id, { type: '미팅', date: '2026-10-10', title: '미팅' }, { now: NOW }) as { id: string };
    updateInteraction(a, m.id, { type: '메모' }, NOW);
    expect(byId(a, c.id).lastMeetingDate).toBe('');
  });
});

// ───────────── 7. 미팅 후 질문 ─────────────
describe('재검증 7: 미팅 후 질문 — 다시 열기·기한 변경·확인 후 값 변경', () => {
  function bare() {
    const a = seedA();
    const r = createCustomer(a, { name: '시험고객', company: '시험상사(가상)' }, { now: NOW, ownerId: 'U1' }) as { id: string };
    const m = addInteraction(a, r.id, { type: '미팅', date: '2026-10-29', time: '14:00', title: '시험 미팅' }, { now: NOW }) as { id: string };
    return { a, cid: r.id, mid: m.id };
  }
  const qids = (a: AssistantData, mid: string) => buildQuestions(a, mid, NOW)!.questions.map((q) => q.id);

  it('같은 미팅을 다시 열면 지금 미팅에서 잘못 누른 「언급 없음」은 질문에서 빠지지 않는다(다른 미팅은 30일 규칙 그대로)', () => {
    const { a, cid, mid } = bare();
    applyFollowup(a, mid, { held: { value: 'yes' }, food_pref: { value: 'none' } }, [], NOW);
    expect(qids(a, mid)).toContain('food_pref'); // 같은 미팅: 고칠 수 있다
    const m2 = addInteraction(a, cid, { type: '미팅', date: '2026-10-28', time: '10:00', title: '다른 미팅' }, { now: NOW }) as { id: string };
    expect(qids(a, m2.id)).not.toContain('food_pref'); // 다른 미팅: 30일 안 재질문 안 함
  });
  it('같은 내용에 새 기한으로 다시 답하면 기한 변경 반영안, 기한이 같으면 「이미 등록된 요청」 안내', () => {
    const { a, cid, mid } = bare();
    const ans = (due: string) => ({ held: { value: 'yes' }, request: { value: '자료 요청', content: '자료 보내기', due_date: due } });
    const first = proposals(a, mid, ans('2026-11-05'), NOW)!;
    const idx = first.proposals.findIndex((p) => p.kind === 'request');
    expect(applyFollowup(a, mid, ans('2026-11-05'), [{ idx, include: true }], NOW)).toMatchObject({ applied: 1 });
    const rid = a.requests.find((r) => r.customerId === cid)!.id;
    // 새 기한
    const again = proposals(a, mid, ans('2026-11-12'), NOW)!;
    expect(again.proposals.filter((p) => p.kind === 'request')).toEqual([]);
    const due = again.proposals.find((p) => p.kind === 'request_due')!;
    expect(due).toMatchObject({ old: '2026-11-05', new: '2026-11-12', value: rid });
    expect(applyFollowup(a, mid, ans('2026-11-12'), [{ idx: again.proposals.indexOf(due), include: true }], NOW)).toMatchObject({ applied: 1 });
    expect(a.requests.filter((r) => r.customerId === cid).length).toBe(1);
    expect(a.requests.find((r) => r.id === rid)!.dueDate).toBe('2026-11-12');
    // 같은 기한
    const same = proposals(a, mid, ans('2026-11-12'), NOW)!;
    expect(same.proposals.filter((p) => p.kind === 'request' || p.kind === 'request_due')).toEqual([]);
    expect(same.problems.find((p) => p.qid === 'request')).toMatchObject({ blocking: false });
    expect(same.problems.find((p) => p.qid === 'request')!.text).toContain('이미 등록된 요청');
  });
  it('확인 뒤 저장 전에 값이 바뀌었으면 그 항목은 덮어쓰지 않고 안내, 다른 항목은 저장', () => {
    const { a, cid, mid } = bare();
    Object.assign(byId(a, cid), { foodLikes: '한식', recentInterests: '골프', nextContactDate: '2026-12-01' });
    const answers = { held: { value: 'yes' }, personality: { value: '결론부터 듣는 것을 선호' }, contact_pref: { value: '이메일' } };
    const r = proposals(a, mid, answers, NOW)!;
    const iPers = r.proposals.findIndex((p) => p.field === 'personality');
    const iCp = r.proposals.findIndex((p) => p.field === 'contactPreference');
    expect(iPers).toBeGreaterThanOrEqual(0);
    expect(iCp).toBeGreaterThanOrEqual(0);
    byId(a, cid).contactPreference = '직접 입력한 전화'; // 확인 화면을 보는 사이에 바뀜
    const out = applyFollowup(a, mid, answers, r.proposals.map((_, idx) => ({ idx, include: true })), NOW, '', r.proposals);
    if (isErr(out)) throw new Error(out.error);
    expect(out.conflicts).toEqual(['선호 연락 방식: 확인 후 값이 바뀌었습니다. 저장하지 않았습니다.']);
    expect(byId(a, cid).contactPreference).toBe('직접 입력한 전화');
    expect(byId(a, cid).personality).toBe('결론부터 듣는 것을 선호');
  });
  it('바뀐 게 없으면 conflicts 칸이 없다(기존 반환 모양 유지)', () => {
    const { a, mid } = bare();
    const out = applyFollowup(a, mid, { held: { value: 'yes' } }, [{ idx: 0, include: true }], NOW);
    expect(out).not.toHaveProperty('conflicts');
  });
});

// ───────────── 8. 바꿔 불러오기·합쳐 불러오기 ─────────────
describe('재검증 8·9: 바꿔 불러오기 담당자 이동·합쳐 불러오기', () => {
  const base = () => JSON.parse(JSON.stringify(createSeed('linked', NOW))) as AppState;
  const noAssistant = (s: AppState) => {
    delete s.assistant;
    return parseBackup(JSON.stringify(s), { seedAssistant: false });
  };
  it('ID가 같아도 사번이 다르면 다른 사람이다: 파일의 사용자로 옮기고 변경 이력에 남긴다', () => {
    const cur = base();
    const file = base();
    const owner = cur.assistant!.customers[0].ownerId;
    cur.users.find((u) => u.id === owner)!.empNo = 'V-1111';
    file.users.find((u) => u.id === owner)!.empNo = 'V-2222';
    const f = noAssistant(file);
    expect(ownerStaysInFile(cur, f, owner)).toBe(false);
    const moved = cur.assistant!.customers.filter((c) => c.ownerId === owner).length;
    expect(replaceCustomerInfo(cur, f).moved).toBe(moved);
    const out = replaceKeepingOtherMemos(cur, f);
    const c0 = out.assistant!.customers.find((c) => c.id === cur.assistant!.customers[0].id)!;
    expect(c0.ownerId).toBe(f.currentUserId);
    const ch = out.assistant!.changes.filter((h) => h.customerId === c0.id && h.field === 'ownerId');
    expect(ch.length).toBe(1);
    expect(ch[0]).toMatchObject({ source: 'import', newValue: replaceMoveTarget(f) });
    expect(ch[0].note).toContain('바꿔 불러오기');
    expect(cur.assistant!.changes.some((h) => h.field === 'ownerId')).toBe(false); // 원본은 건드리지 않는다
  });
  it('사번이 같거나 한쪽이 비어 있으면 같은 사람으로 본다 → 옮기지 않고 이력도 없다', () => {
    const cur = base();
    const file = base();
    const owner = cur.assistant!.customers[0].ownerId;
    expect(ownerStaysInFile(cur, noAssistant(file), owner)).toBe(true);
    const f2 = noAssistant(base());
    f2.users.find((u) => u.id === owner)!.empNo = '';
    expect(ownerStaysInFile(cur, f2, owner)).toBe(true);
    const out = replaceKeepingOtherMemos(cur, noAssistant(base()));
    expect(out.assistant!.changes.some((h) => h.field === 'ownerId')).toBe(false);
  });
  it('합쳐 불러오기: 파일 사람 목록 밖 담당자의 고객은 지금 사용자 담당으로 들어온다', () => {
    const cur = base();
    const inc = base();
    inc.assistant!.customers = [];
    inc.assistant!.interactions = [];
    inc.assistant!.requests = [];
    inc.assistant!.anniversaries = [];
    inc.assistant!.changes = [];
    inc.assistant!.followups = [];
    const r = createCustomer(inc.assistant!, { name: '들어온 고객', company: '들어온상사(가상)' }, { now: NOW, ownerId: 'U-파일에없음' }) as { id: string };
    const { state } = applyMerge(cur, inc);
    const got = state.assistant!.customers.find((c) => c.name === '들어온 고객')!;
    expect(got.ownerId).toBe(cur.currentUserId);
    expect(r.id).toBeTruthy();
  });
  it('합쳐 불러오기 미리 보기용: 파일의 가상 고객 수', () => {
    const inc = base();
    expect(skippedDemoCustomers(inc)).toBe(18);
    inc.assistant!.customers = inc.assistant!.customers.filter((c) => !c.isDemo);
    expect(skippedDemoCustomers(inc)).toBe(0);
    expect(skippedDemoCustomers(noAssistant(base()))).toBe(0);
  });
  it('mergeImport sameCustomer: 숫자 아닌 글자만 지우는 \\D (오타 /D/ 수정) — 전화 칸에 숫자 없는 기호만 있으면 비어 있는 것으로 본다', () => {
    const mk = (over: Partial<Customer>) => ({ name: '홍시험', company: '', mobile: '', email: '', ...over }) as Customer;
    expect(sameCustomer(mk({ mobile: '-' }), mk({}))).toBe(true);
    expect(sameCustomer(mk({ mobile: '010-1234-5678' }), mk({}))).toBe(false);
  });
});

// ───────────── 9. 작은 것들 ─────────────
describe('재검증 9: 목록 비교는 공백 무시(값은 원래 표기 유지), 가림 구분자는 줄바꿈을 넘지 않는다', () => {
  it('lists: 「매운 음식」=「매운음식」', () => {
    expect(listHas('매운 음식, 한식', '매운음식')).toBe(true);
    expect(listHas('한 식', '한식')).toBe(true);
    expect(appendToList('매운 음식', '매운음식')).toBeNull();
    expect(appendToList('매운 음식', '단 음식')).toBe('매운 음식, 단 음식'); // 기존 표기 유지
    expect(appendToList('한식', '중 식')).toBe('한식, 중 식'); // 새 값의 표기도 그대로
  });
  it.each([
    ['1600-1730', '1600-1730'],
    ['1800-2000 사이', '1800-2000 사이'],
    ['건수 1200 300 45000', '건수 1200 300 45000'],
    ['오전 0900-1800 근무', '오전 0900-1800 근무'],
  ])('오탐 없음: %s', (raw) => {
    expect(maskText(raw)).toEqual([raw, 0]);
  });
  it('줄바꿈은 넘지 않는다: 줄이 다른 두 숫자를 한 번호로 묶지 않는다', () => {
    for (const raw of ['010\n1234\n5678', '110\n123\n456789', '1234\n5678\n9012\n3456', '02\n123\n4567', '900101\n1234567', '1588\n1234']) {
      expect(maskText(raw)).toEqual([raw, 0]);
    }
  });
  it('가림 7가지(앞 단계 시험)는 그대로', () => {
    for (const [raw, label] of [['010 - 1234 - 5678', '[휴대전화]'], ['010 1234 5678', '[휴대전화]'], ['+82 10 1234 5678', '[휴대전화]'], ['1234 5678 9012 3456', '[번호]'], ['110 123 456789', '[번호]'], ['900101 1234567', '[주민등록번호]'], ['1588-1234', '[전화번호]'], ['031 123 4567', '[전화번호]']]) {
      expect(maskText(`연락처는 ${raw} 입니다.`)[0]).toBe(`연락처는 ${label} 입니다.`);
    }
  });
  it('진짜 대표번호는 시각 범위로 오인하지 않는다', () => {
    expect(maskText('대표번호 1588-1234')[0]).toBe('대표번호 [전화번호]');
    expect(maskText('대표번호 1566-0000')[0]).toBe('대표번호 [전화번호]');
    expect(maskText('고객센터 1544-1000')[0]).toBe('고객센터 [전화번호]'); // 15:44, 10:00 — 앞이 더 늦으므로 시각 범위가 아니다
  });
});
