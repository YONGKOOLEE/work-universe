// AI 비서의 Claude 호출 쪽: 가림, 전송 내용(프로필 미포함), 구조화 응답, 근거 문장 원문 대조, 승인(체크만 저장·추측·충돌), 질문 해석(질문+기준일만). 가짜 SDK만 쓴다(실제 호출 없음).
import { describe, expect, it } from 'vitest';
import { createClient, LIMITS, LlmError } from '../src/ai/llm';
import { createAssistantSeed } from '../src/assistant/seed';
import { createCustomer, isErr } from '../src/assistant/model';
import { sampleDraft, SAMPLE_LABEL, SAMPLE_TEXT } from '../src/assistant/sample';
import { aiParse, aiQuestionPrompt, executeSearch, ruleParse, SEARCH_SCHEMA, searchQuestion } from '../src/assistant/nlsearch';
import {
  analyzeConversation, applyDraft, buildSendPreview, CONV_SCHEMA, CONV_SYSTEM, enrichDraft, maskText, normalizeConv, prepareText, verifyQuote,
  type Draft, type EnrichedDraft,
} from '../src/assistant/claude';
import type { AssistantData } from '../src/assistant/types';

const NOW = new Date(2026, 9, 30, 10, 0, 0);
/** 받은 요청을 적어 두는 가짜 SDK */
const spy = (output: unknown) => {
  const reqs: any[] = [];
  const client = createClient('test', 'fake-model', {
    messages: {
      parse: async (req: any) => {
        reqs.push(req);
        return { stop_reason: 'end_turn', parsed_output: output };
      },
    },
  });
  return { client, reqs };
};
const failing = (code: number) => createClient('test', 'fake-model', { messages: { parse: async () => { throw Object.assign(new Error('x'), { status: code }); } } });

function setup() {
  const a = createAssistantSeed(NOW, 'U1');
  const id = (name: string) => a.customers.find((c) => c.name === name)!.id;
  return { a, id };
}
const TEXT = `나: 부장님 안녕하세요.
이서준: 저는 요즘 골프를 시작했어요. 제 번호는 010-1234-5678 이고 메일은 seojun.test@sample.example 입니다.
나: 네, 다음 주 금요일까지 자료 보내드리겠습니다.
이서준: 아 그리고 회식은 한식이 좋아요. 계좌는 123-456-789012 입니다. 주민번호 900101-1234567 은 안 알려드려요.`;

describe('개인정보 가림', () => {
  it('주민등록번호·이메일·휴대전화·일반전화·계좌 형태를 가리고 건수를 센다', () => {
    const [t, n] = maskText(TEXT);
    expect(t).not.toMatch(/010-1234-5678|seojun\.test|123-456-789012|900101-1234567/);
    expect(t).toContain('[휴대전화]');
    expect(t).toContain('[이메일]');
    expect(t).toContain('[번호]');
    expect(t).toContain('[주민등록번호]');
    expect(n).toBe(4);
    expect(maskText('사무실 02-123-4567 입니다')[0]).toBe('사무실 [전화번호] 입니다');
  });
  it('날짜(2026-11-05)와 짧은 숫자는 가리지 않고, 조사가 붙은 번호도 가린다', () => {
    expect(maskText('2026-11-05에 3번 만났다')).toEqual(['2026-11-05에 3번 만났다', 0]);
    expect(maskText('01012345678로 연락')[0]).toBe('[휴대전화]로 연락');
  });
  it('글 정리: 빈 글·6만 자 초과는 오류, 가리기를 끄면 그대로', () => {
    expect(prepareText('  ')).toEqual({ error: '분석할 대화 내용이 없습니다.' });
    expect(prepareText('a'.repeat(60001))).toEqual({ error: '대화기록이 너무 깁니다. (최대 6만 자) 나누어 분석해 주세요.' });
    const raw = prepareText('번호 010-1234-5678\r\n끝', false);
    expect(raw).toEqual({ original: '번호 010-1234-5678\n끝', sent: '번호 010-1234-5678\n끝', maskedCount: 0 });
  });
});

describe('전송 내용: 가림 결과와 고객 이름 한 줄뿐(프로필 미포함)', () => {
  it('확인 화면 미리보기와 실제 요청이 같고, 전화·이메일·프로필은 들어 있지 않다', async () => {
    const { a, id } = setup();
    const kim = a.customers.find((c) => c.name === '김도현')!;
    const { client, reqs } = spy({ title: '', interactionType: '통화', interactionDate: '', summary: '', speakerNote: '', profileItems: [], requests: [], followups: [] });
    const pv = buildSendPreview(kim, TEXT, NOW, { myName: '시험담당' });
    if ('error' in pv) throw new Error(pv.error);
    expect(pv.customerLabel).toBe('김도현 부장 (가온은행)');
    expect(pv.maskedCount).toBe(4);
    await analyzeConversation(client, a, { customerId: id('김도현'), text: TEXT, myName: '시험담당' }, NOW);
    const user: string = reqs[0].messages[0].content;
    expect(user).toBe(pv.userPrompt);
    expect(user).toContain('기준일(오늘): 2026-10-30');
    expect(user).toContain('고객: 김도현 부장 (가온은행)');
    expect(user).toContain('[휴대전화]');
    // 프로필·연락처·메모는 한 글자도 보내지 않는다
    const sent = JSON.stringify(reqs[0]);
    for (const secret of [kim.mobile, kim.email, kim.personality, kim.salesNotes, kim.companyAddress, kim.orgRelationship, '010-1234-5678', 'seojun.test', '해산물', '골프, 등산']) expect(sent).not.toContain(secret);
    expect(reqs[0].system).toBe(CONV_SYSTEM);
    expect(reqs[0].max_tokens).toBe(LIMITS.convAnalyze.maxTokens);
    expect(JSON.stringify(reqs[0].output_config.format)).toContain('profileItems');
  });
  it('호출 한도에 대화 분석·질문 해석 항목이 있다', () => {
    expect(LIMITS.convAnalyze.timeoutMs).toBeGreaterThanOrEqual(60000);
    expect(LIMITS.queryParse.maxTokens).toBeLessThanOrEqual(4000);
    expect(CONV_SCHEMA.additionalProperties).toBe(false);
    expect(SEARCH_SCHEMA.additionalProperties).toBe(false);
  });
  it('고객이 없으면 호출하지 않는다', async () => {
    const { a } = setup();
    const { client, reqs } = spy({});
    expect(await analyzeConversation(client, a, { customerId: 'CU-999', text: TEXT }, NOW)).toEqual({ error: '고객을 찾을 수 없습니다.' });
    expect(await analyzeConversation(client, a, { customerId: a.customers[0].id, text: '' }, NOW)).toEqual({ error: '분석할 대화 내용이 없습니다.' });
    expect(reqs).toEqual([]);
  });
  it('호출 오류는 LlmError로 그대로 올라온다(키 거부 등)', async () => {
    const { a, id } = setup();
    await expect(analyzeConversation(failing(401), a, { customerId: id('김도현'), text: TEXT }, NOW)).rejects.toMatchObject({ code: 'auth' });
    await expect(analyzeConversation(failing(429), a, { customerId: id('김도현'), text: TEXT }, NOW)).rejects.toBeInstanceOf(LlmError);
  });
});

describe('근거 문장을 원문과 대조(CR-25 2.3-1)', () => {
  const src = '김도현: 요즘 주말마다 “테니스” 배우느라 정신이 없어요.\n나: 네 알겠습니다.\n김도현: 메일보다는 전화가 편해요.';
  it('공백·따옴표 차이는 무시하고 원문에서 일치한 구간을 돌려준다', () => {
    const v = verifyQuote('요즘 주말마다 "테니스"   배우느라 정신이 없어요.', src);
    expect(v.ok).toBe(true);
    expect(v.span).toBe('요즘 주말마다 “테니스” 배우느라 정신이 없어요.');
  });
  it('말머리(화자 이름)는 떼고 한 번 더 찾고, 말줄임으로 이은 근거는 조각마다 찾는다', () => {
    expect(verifyQuote('김도현: 메일보다는 전화가 편해요.', src).ok).toBe(true);
    expect(verifyQuote('요즘 주말마다 “테니스” 배우느라 ... 메일보다는 전화가 편해요.', src).ok).toBe(true);
    expect(verifyQuote('요즘 주말마다 “테니스” 배우느라 … 골프가 좋아요 정말로', src).ok).toBe(false);
  });
  it('지어낸 문장·너무 짧은 문장·빈 글은 실패', () => {
    expect(verifyQuote('요즘 주말마다 골프를 치러 다녀요', src).ok).toBe(false);
    expect(verifyQuote('전화', src).ok).toBe(false);
    expect(verifyQuote('', src).ok).toBe(false);
    expect(verifyQuote('메일보다는 전화가 편해요', '').ok).toBe(false);
  });
  it('가림 처리된 원문 기준: 가려진 글로 대조하고, 원래 번호를 쓴 근거는 통과하지 못한다', async () => {
    const { a, id } = setup();
    const out = {
      title: '통화', interactionType: '통화', interactionDate: '2026-10-30', summary: '요약', speakerNote: '',
      profileItems: [
        { field: 'contactPreference', value: '이메일', evidence: '메일은 [이메일] 입니다', speaker: 'customer', confidence: 'high', isSpeculation: false }, // 가린 글 기준 → 통과
        { field: 'contactPreference', value: '휴대전화', evidence: '제 번호는 010-1234-5678 이고', speaker: 'customer', confidence: 'high', isSpeculation: false }, // 원래 번호 → 실패
      ],
      requests: [], followups: [],
    };
    const d = (await analyzeConversation(spy(out).client, a, { customerId: id('김도현'), text: TEXT }, NOW)) as Draft;
    expect(d.items.map((i) => i.quoteVerified)).toEqual([true, false]);
    expect(d.sentText).not.toContain('010-1234-5678');
    expect(d.original).toContain('010-1234-5678'); // 원문은 화면 메모리에만
  });
  it('원문 확인이 안 된 항목은 「원문 확인 안 됨」으로 기본 해제된다', async () => {
    const { a, id } = setup();
    const out = {
      title: '통화', interactionType: '통화', interactionDate: '', summary: '', speakerNote: '',
      profileItems: [
        { field: 'hobbies', value: '골프', evidence: '저는 요즘 골프를 시작했어요.', speaker: 'customer', confidence: 'high', isSpeculation: false },
        { field: 'hobbies', value: '낚시', evidence: '주말마다 낚시를 다니는 걸 좋아합니다', speaker: 'customer', confidence: 'high', isSpeculation: false },
      ],
      requests: [{ content: '자료 전달', dueDate: '2026-11-06', assignee: '', evidence: '다음 주 금요일까지 자료 보내드리겠습니다.', confidence: 'high' }, { content: '지어낸 요청', dueDate: '', assignee: '', evidence: '존재하지 않는 문장입니다 정말로', confidence: 'high' }],
      followups: [],
    };
    const d = (await analyzeConversation(spy(out).client, a, { customerId: id('박준혁'), text: TEXT }, NOW)) as Draft; // 취미가 비어 있는 고객
    const e = enrichDraft(a, d) as EnrichedDraft;
    expect(e.items.map((i) => [i.value ?? i.content, i.quoteVerified, i.include])).toEqual([['골프', true, true], ['낚시', false, false], ['자료 전달', true, true], ['지어낸 요청', false, false]]);
    expect(e.items[1].warnings).toContain('원문 확인 안 됨');
    expect(e.items[0].quoteSpan).toBe('저는 요즘 골프를 시작했어요.');
  });
});

describe('구조화 응답 정리', () => {
  it('이상한 값은 안전한 값으로: 유형·화자·신뢰도·날짜·항목 이름', () => {
    const r = normalizeConv({
      title: '', interactionType: '엉뚱', interactionDate: '2026-02-30', summary: ' 요약 ', speakerNote: null,
      profileItems: [{ field: 'name', value: '바꾸면 안 됨', evidence: 'x' }, { field: 'hobbies', value: '', evidence: 'x' }, { field: 'hobbies', value: '독서', evidence: '독서를 해요 항상', speaker: '누구', confidence: '모름', isSpeculation: 1 }],
      requests: [{ content: '', dueDate: '' }, { content: '요청', dueDate: '2026-13-40', evidence: 'e' }],
      followups: [{ content: '후속', evidence: 'e' }, null],
    });
    expect(r).toMatchObject({ title: '대화기록 분석', interactionType: '기타', interactionDate: '', summary: '요약', speakerNote: '' });
    expect(r.items.map((i) => i.kind)).toEqual(['profile', 'request', 'followup']);
    expect(r.items[0]).toMatchObject({ field: 'hobbies', speaker: 'unclear', confidence: 'low', isSpeculation: true, quoteVerified: false });
    expect(r.items[1]).toMatchObject({ dueDate: '', speaker: 'customer', confidence: 'medium' });
    expect(normalizeConv(null).items).toEqual([]);
  });
});

describe('승인: 체크한 항목만 저장', () => {
  const kimDraft = (a: AssistantData, id: (n: string) => string) => {
    const d = sampleDraft(a, id('김도현'), NOW) as Draft;
    return { d, e: enrichDraft(a, d) as EnrichedDraft };
  };
  it('예시 분석: 추측·영업사원 발언·기존 값과 충돌하는 단일 항목은 기본 해제, 목록 항목은 충돌이어도 해제하지 않음', () => {
    const { a, id } = setup();
    const { e } = kimDraft(a, id);
    const by = (field: string) => e.items.find((i) => i.field === field)!;
    expect(by('salesNotes')).toMatchObject({ include: false, warnings: expect.arrayContaining(['추측', '화자 불확실', '신뢰도 낮음']) });
    expect(by('contactPreference')).toMatchObject({ status: 'conflict', include: false, existing: '오전 중 전화' }); // 단일 항목 충돌
    expect(by('foodLikes')).toMatchObject({ status: 'conflict', include: true, mode: 'append', isList: true }); // 목록 항목: 이어 붙임
    expect(by('hobbies')).toMatchObject({ include: true, mode: 'append' });
    expect(e.items.find((i) => i.kind === 'followup')).toMatchObject({ include: true });
    // 기존 값과 같으면 해제
    a.customers.find((c) => c.name === '김도현')!.hobbies = '테니스';
    const e2 = enrichDraft(a, kimDraft(a, id).d) as EnrichedDraft;
    expect(e2.items.find((i) => i.field === 'hobbies')).toMatchObject({ status: 'same', include: false });
  });
  it('체크한 항목만 고객 항목·요청에 저장되고, 변경 이력에 출처 「예시 분석」이 남는다', () => {
    const { a, id } = setup();
    const { d } = kimDraft(a, id);
    const idx = (f: string) => d.items.findIndex((i) => i.field === f);
    const r = applyDraft(a, d, [{ idx: idx('hobbies'), include: true, mode: 'append' }, { idx: idx('foodLikes'), include: false }, { idx: d.items.findIndex((i) => i.kind === 'request'), include: true }], {}, NOW);
    expect(r).toMatchObject({ applied: { profile: 1, request: 1, followup: 0 } });
    const c = a.customers.find((x) => x.name === '김도현')!;
    expect(c.hobbies).toBe('골프, 등산, 테니스');
    expect(c.foodLikes).toBe('한식'); // 체크 안 한 항목은 그대로
    const h = a.changes.filter((x) => x.source === 'sample');
    expect(h.map((x) => x.field)).toEqual(['hobbies']);
    expect(h[0].note).toBe('예시 분석 승인 (예시 대화)'); // 파일명에 고객 이름이 들어가지 않는다(검토 14)
    expect(a.requests.filter((x) => x.customerId === c.id && x.source === 'sample').length).toBe(1);
    expect(SAMPLE_LABEL).toBe('예시 분석(AI 미사용)');
  });
  it('추측 항목을 체크하면 고객 항목이 아니라 「영업 시 참고사항」에 「(추정)」으로만 붙는다', () => {
    const { a, id } = setup();
    const { d } = kimDraft(a, id);
    const i = d.items.findIndex((x) => x.field === 'salesNotes');
    const before = a.customers.find((c) => c.name === '김도현')!.salesNotes;
    applyDraft(a, d, [{ idx: i, include: true }], {}, NOW);
    const c = a.customers.find((x) => x.name === '김도현')!;
    expect(c.salesNotes).toBe(`${before}\n(추정) 영업 시 참고사항: 연말 인사 이동 가능성`);
    expect(a.changes.at(-1)!.note).toContain('추정 정보');
  });
  it('후속조치는 요청사항에만 저장한다(「[후속조치]」 접두어, 활동 상세에는 쓰지 않음)', () => {
    const { a, id } = setup();
    const { d } = kimDraft(a, id);
    const i = d.items.findIndex((x) => x.kind === 'followup');
    const r = applyDraft(a, d, [{ idx: i, include: true }], {}, NOW) as { interactionId: string };
    expect(a.requests.at(-1)).toMatchObject({ content: '[후속조치] 다음 달 초 방문 미팅 및 점심 일정 잡기', interactionId: r.interactionId });
    expect(a.interactions.find((x) => x.id === r.interactionId)!.details).toBe('');
  });
  it('원문 보관을 고르면 활동 상세에 대화 원문이 들어가고, 고르지 않으면 들어가지 않는다', () => {
    const { a, id } = setup();
    const { d } = kimDraft(a, id);
    const r1 = applyDraft(a, d, [], { keepText: true }, NOW) as { interactionId: string };
    expect(a.interactions.find((x) => x.id === r1.interactionId)!.details).toBe(`[대화 원문]\n${SAMPLE_TEXT.trim()}`);
    const r2 = applyDraft(a, d, [], {}, NOW) as { interactionId: string };
    expect(a.interactions.find((x) => x.id === r2.interactionId)!.details).toBe('');
  });
  it('활동 기록은 승인 화면에서 고친 값으로 저장된다. 실제 AI 분석이면 최근 연락일이 올라가고, 시험용 예시 분석이면 올라가지 않는다(검토 14)', () => {
    const { a, id } = setup();
    const { d } = kimDraft(a, id);
    const before = a.customers.find((c) => c.name === '김도현')!.lastMeetingDate;
    applyDraft(a, d, [], { interaction: { type: '미팅', date: '2026-10-29', title: '고친 제목', summary: '고친 요약' } }, NOW);
    const m = a.interactions.at(-1)!;
    expect(m).toMatchObject({ type: '미팅', date: '2026-10-29', title: '고친 제목', summary: '고친 요약', source: 'sample', sourceFile: '예시 대화' });
    expect(a.customers.find((c) => c.name === '김도현')!.lastMeetingDate).toBe(before); // 예시는 실제 미팅이 아니다
    // 실제 AI 분석(kind: ai)은 지금처럼 올린다
    applyDraft(a, { ...d, kind: 'ai' }, [], { interaction: { type: '미팅', date: '2026-10-29', title: '실제', summary: '' } }, NOW);
    expect(a.customers.find((c) => c.name === '김도현')!).toMatchObject({ lastMeetingDate: '2026-10-29' });
  });
  it('값 검사에 걸리면 아무것도 저장하지 않는다(날짜·고객)', () => {
    const { a, id } = setup();
    const { d } = kimDraft(a, id);
    const snap = JSON.stringify(a);
    const ri = d.items.findIndex((x) => x.kind === 'request');
    expect(applyDraft(a, d, [{ idx: ri, include: true, dueDate: '2026-02-30' }], {}, NOW)).toEqual({ error: '처리기한이(가) 존재하지 않는 날짜입니다.' });
    expect(applyDraft(a, d, [], { interaction: { date: '2026-13-01' } }, NOW)).toEqual({ error: '대화 날짜이(가) 존재하지 않는 날짜입니다.' });
    expect(JSON.stringify(a)).toBe(snap);
    expect(isErr(applyDraft(a, { ...d, customerId: 'CU-999' }, [], {}, NOW))).toBe(true);
  });
  it('날짜 항목(다음 연락일) 값이 날짜가 아니면 저장 전에 거절', () => {
    const { a, id } = setup();
    const d = { ...(sampleDraft(a, id('박준혁'), NOW) as Draft) };
    d.items = [{ kind: 'profile', field: 'nextContactDate', fieldLabel: '다음 연락·미팅 예정일', value: '내일쯤', evidence: '내일쯤 연락 주세요 라고 했다', speaker: 'customer', confidence: 'high', isSpeculation: false, quoteVerified: false }];
    const snap = JSON.stringify(a);
    expect(applyDraft(a, d, [{ idx: 0, include: true }], {}, NOW)).toEqual({ error: '다음 연락·미팅 예정일 형식이 올바르지 않습니다. (예: 2026-11-05)' });
    expect(JSON.stringify(a)).toBe(snap);
  });
});

describe('질문 해석(AI): 질문과 기준일만 보낸다', () => {
  const out = {
    target: 'customers', keywords: [{ text: '골프', scope: 'interest' }], conversationKeywords: [], orgKeywords: ['은행'], customerTypes: ['참가기관'],
    noContactDays: null, contactKind: 'contact', birthdayFrom: '', birthdayTo: '', requestStatus: '', requestKeywords: [], dueWithinDays: null, overdue: false, agendaFrom: '', agendaTo: '',
  };
  it('요청 내용에는 기준일·질문뿐이고 고객 이름·연락처·고객 데이터가 없다', async () => {
    const { a } = setup();
    const { client, reqs } = spy(out);
    const q = '골프 좋아하는 은행 담당자 찾아줘';
    const cond = await aiParse(client, q, NOW);
    expect(cond).toMatchObject({ keywords: [{ text: '골프', scope: 'interest' }], orgKeywords: ['은행'], customerTypes: ['참가기관'] });
    expect(reqs[0].messages[0].content).toBe(`기준일(오늘): 2026-10-30 (금요일)\n질문: ${q}`);
    expect(aiQuestionPrompt(q, NOW)).toBe(reqs[0].messages[0].content);
    const sent = JSON.stringify(reqs[0]);
    for (const c of a.customers) for (const secret of [c.name, c.mobile, c.email, c.company]) expect(sent).not.toContain(secret);
    expect(reqs[0].max_tokens).toBe(LIMITS.queryParse.maxTokens);
  });
  it('AI 해석 결과도 정리된다(잘못된 날짜·범위 밖 일수·알 수 없는 범위)', async () => {
    const bad = { ...out, keywords: [{ text: '  골프  ', scope: '엉뚱' }, { text: '', scope: 'interest' }], noContactDays: 99999, birthdayFrom: '2026-11-01', birthdayTo: '2026-99-99', dueWithinDays: 0, customerTypes: ['협력사', '없는유형'], agendaFrom: '2026-10-30', agendaTo: '' };
    const c = await aiParse(spy(bad).client, '질문', NOW);
    expect(c.keywords).toEqual([{ text: '골프', scope: 'any' }]);
    expect(c.noContactDays).toBeNull();
    expect(c.birthdayFrom).toBe('2026-11-01');
    expect(c.birthdayTo).toBe('2026-12-01'); // 한쪽만 있으면 30일 뒤로 채움
    expect(c.dueWithinDays).toBeNull(); // 0은 조건 없음(원본과 같음)
    expect(c.customerTypes).toEqual(['협력사']);
    expect(c.agendaTo).toBe('2026-11-29');
  });
  it('질문 검색: AI가 성공하면 mode=ai, 실패하면 규칙 해석으로 대체하고 이유를 알린다', async () => {
    const { a } = setup();
    const ok = (await searchQuestion(a, '골프 좋아하는 은행 담당자 찾아줘', NOW, { client: spy(out).client })) as any;
    expect(ok).toMatchObject({ mode: 'ai', aiError: '' });
    expect(ok.customers.map((c: any) => c.name)).toEqual(['김도현']);
    const fb = (await searchQuestion(a, '골프 좋아하는 은행 담당자 찾아줘', NOW, { client: failing(429), errorText: () => '한도' })) as any;
    expect(fb).toMatchObject({ mode: 'rule', aiError: '한도' });
    expect(fb.customers.map((c: any) => c.name)).toEqual(['김도현']);
    const rule = (await searchQuestion(a, '골프 좋아하는 은행 담당자 찾아줘', NOW)) as any;
    expect(rule.mode).toBe('rule');
    expect(await searchQuestion(a, '  ', NOW)).toEqual({ error: '검색할 문장을 입력해 주세요.' });
    expect(await searchQuestion(a, 'a'.repeat(201), NOW)).toEqual({ error: '질문이 너무 깁니다. (200자 이내)' });
  });
});

describe('규칙 검색 낱말 보강(CR-25 2.3-3)', () => {
  const { a } = setup();
  const names = (q: string) => executeSearch(a, ruleParse(q, NOW), NOW).customers.map((c) => c.name);
  it('피하는 음식 표현: 못 드시는·안 드시는·꺼리는·먹지 않는·못 먹는·싫어하시는', () => {
    for (const q of ['해산물 못 드시는 분', '해산물을 못 드시는 고객', '해산물 안 드시는 분 찾아줘', '해산물 꺼리는 분', '해산물 먹지 않는 고객', '해산물 못 먹는 사람', '해산물 싫어하시는 분', '해산물 기피하는 고객', '해산물을 먹지 못하는 분']) {
      expect(names(q), q).toEqual(['김도현']);
    }
    expect(names('날음식 못 드시는 분')).toEqual(['장태우']);
    expect(names('고기류 안 먹는 사람')).toEqual(['임가영']);
  });
  it('「음식」 같은 군더더기 낱말은 건너뛴다', () => {
    expect(ruleParse('매운 음식 싫어하는 분', NOW).keywords).toEqual([{ text: '매운', scope: 'food_dislike' }]);
    expect(ruleParse('해산물 음식을 못 드시는 분', NOW).keywords).toEqual([{ text: '해산물', scope: 'food_dislike' }]);
  });
  it('이번 달에 챙겨야 할 사람: 기한 임박·지난 요청, 생일, 기념일, 예정 연락, 예정 미팅(보류·완료 요청은 제외)', () => {
    const c = ruleParse('이번 달에 내가 챙겨야 할 사람 누구야', NOW);
    expect([c.agendaFrom, c.agendaTo]).toEqual(['2026-10-30', '2026-10-31']);
    const res = executeSearch(a, c, NOW);
    expect(res.customers.map((x) => x.name)).toEqual(['조성훈', '김도현', '오정석', '장태우']);
    const ev = (n: string) => res.customers.find((x) => x.name === n)!.evidence.map((e) => e.label);
    expect(ev('조성훈')).toEqual(['예정 연락', expect.stringContaining('요청사항')]);
    expect(ev('김도현')).toEqual([expect.stringContaining('요청사항')]);
    expect(ev('오정석')).toEqual(['생일']);
    expect(ev('장태우')).toEqual(['예정 연락', '예정 미팅']);
    expect(res.customers.some((x) => x.name === '강하은')).toBe(false); // 보류 요청
    expect(describeText(c)).toContain('10/30~10/31 챙길 일');
  });
  it('기간 표현: 이번 주·다음 달·다음 주·내일·오늘', () => {
    const p = (q: string) => { const c = ruleParse(q, NOW); return [c.agendaFrom, c.agendaTo]; };
    expect(p('이번 주에 챙겨야 할 분')).toEqual(['2026-10-30', '2026-11-01']);
    expect(p('다음 달에 챙길 고객')).toEqual(['2026-11-01', '2026-11-30']);
    expect(p('다음 주에 연락해야 할 사람')).toEqual(['2026-11-02', '2026-11-08']);
    expect(p('내일 챙겨야 할 사람')).toEqual(['2026-10-31', '2026-10-31']);
    expect(p('오늘 신경 써야 할 고객')).toEqual(['2026-10-30', '2026-10-30']);
    expect(p('챙겨야 할 사람')).toEqual(['2026-10-30', '2026-11-29']);
  });
});
function describeText(c: ReturnType<typeof ruleParse>) {
  return c.agendaFrom ? `${c.agendaFrom.slice(5).replace('-', '/')}~${c.agendaTo.slice(5).replace('-', '/')} 챙길 일` : '';
}

describe('데모 고객과 직접 등록 고객이 섞여도', () => {
  it('내가 등록한 고객은 이력이 남고 데모 고객은 남지 않는다', () => {
    const { a } = setup();
    expect(a.changes.length).toBe(0);
    createCustomer(a, { name: '새고객', company: '시험(가상)' }, { now: NOW, ownerId: 'U1' });
    expect(a.changes.length).toBe(2);
  });
});
