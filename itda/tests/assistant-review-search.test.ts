// 검토(2026-10-30)로 나온 묻기(nlsearch) 문제의 회귀 시험 — 표의 질문이 표의 결과가 되는지, 맞던 결과가 그대로인지.
import { describe, expect, it } from 'vitest';
import { createAssistantSeed } from '../src/assistant/seed';
import { aiQuestionPrompt, describeCond, executeSearch, ruleParse, searchQuestion, NO_CUSTOMERS_NOTE } from '../src/assistant/nlsearch';
import { emptyAssistant } from '../src/assistant/model';

const NOW = new Date(2026, 9, 30, 10, 0, 0); // 2026-10-30 10:00 (금)
const a = createAssistantSeed(NOW, 'U1');
const names = a.customers.map((c) => c.name);
/** 화면(searchQuestion)과 같은 경로: 고객 이름 목록을 넘겨 해석한다 */
const ask = (q: string, withNames = true) => {
  const cond = ruleParse(q, NOW, withNames ? names : []);
  return { cond, res: executeSearch(a, cond, NOW), explain: describeCond(cond) };
};
const who = (q: string, withNames = true) => ask(q, withNames).res.customers.map((c) => c.name).sort();

describe('묻기: 검토 표의 질문', () => {
  for (const withNames of [true, false]) {
    const tag = withNames ? '(이름 목록 있음)' : '(이름 목록 없음)';
    it(`이번 주에 만나는 사람 / 이번 주 미팅 예정 고객 → 앞으로 7일 안 미팅 예정자 ${tag}`, () => {
      expect(who('이번 주에 만나는 사람', withNames)).toEqual(['김도현', '장태우']);
      expect(who('이번 주 미팅 예정 고객', withNames)).toEqual(['김도현', '장태우']);
      const x = ask('이번 주에 만나는 사람', withNames);
      expect(x.cond.meetingFrom).toBe('2026-10-30');
      expect(x.cond.meetingTo).toBe('2026-11-06');
      expect(x.cond.keywords).toEqual([]);
      expect(x.explain).toEqual(['10/30~11/06 예정 미팅']);
      // 근거는 예정 미팅 줄
      expect(x.res.customers.every((c) => c.evidence.some((e) => e.label === '예정 미팅'))).toBe(true);
    });
    it(`다음 주에 만날 사람 → 다음 주 범위(시드엔 0명), 조건 설명이 범위와 맞다 ${tag}`, () => {
      const x = ask('다음 주에 만날 사람', withNames);
      expect(x.res.count).toBe(0);
      expect(x.cond.meetingFrom).toBe('2026-11-02');
      expect(x.cond.meetingTo).toBe('2026-11-08');
      expect(x.explain).toEqual(['11/02~11/08 예정 미팅']);
    });
    it(`기한 지난 요청 → 「기한이 지난 요청사항」과 같은 결과, 소속 「청」으로 읽지 않는다 ${tag}`, () => {
      const x = ask('기한 지난 요청', withNames);
      const y = ask('기한이 지난 요청사항 보여줘', withNames);
      expect(x.cond.orgKeywords).toEqual([]);
      expect(x.cond).toEqual(y.cond);
      expect(x.res.target).toBe('requests');
      expect(x.res.requests.map((r) => r.id)).toEqual(y.res.requests.map((r) => r.id));
      expect(x.res.count).toBe(2);
    });
    it(`오정석 생일 언제야 → 오정석 1명(이름이 조건) ${tag}`, () => {
      const x = ask('오정석 생일 언제야', withNames);
      expect(x.res.customers.map((c) => c.name)).toEqual(['오정석']);
      expect(x.cond.nameKeywords).toEqual(['오정석']);
      expect(x.cond.keywords).toEqual([]);
      expect(x.cond.birthdayFrom).toBe('');
      const ev = x.res.customers[0].evidence;
      expect(ev.find((e) => e.label === '생일')!.text).toMatch(/^10월 \d+일/);
    });
    it(`김도현 연락처 → 김도현, 연락처를 근거로 보인다 ${tag}`, () => {
      const x = ask('김도현 연락처', withNames);
      expect(x.res.customers.map((c) => c.name)).toEqual(['김도현']);
      expect(x.res.customers[0].evidence.find((e) => e.label === '휴대전화')!.text).toBe('010-0000-1001');
    });
    it(`메신저 선호하는 사람 / 이메일 연락 선호 → 선호 연락 방식이 일치하는 고객 ${tag}`, () => {
      expect(who('메신저 선호하는 사람', withNames)).toEqual(['노은지', '장태우']);
      expect(who('이메일 연락 선호', withNames)).toEqual(['서민재', '신예린', '이서연']);
      const x = ask('메신저 선호하는 사람', withNames);
      expect(x.cond.keywords).toEqual([{ text: '메신저', scope: 'contact_pref' }]);
      expect(x.res.customers[0].evidence[0].label).toBe('선호 연락 방식');
    });
  }
});

describe('묻기: 맞던 결과는 그대로', () => {
  const n = (q: string) => who(q);
  it('일식 좋아하는 분', () => expect(ask('일식 좋아하는 분').cond.keywords).toEqual([{ text: '일식', scope: 'food_like' }]));
  it('연락 안 한 지 오래된 은행 담당자 → 박준혁', () => expect(n('연락 안 한 지 오래된 은행 담당자')).toContain('박준혁'));
  it('생일 다가오는 사람', () => expect(ask('생일 다가오는 사람').res.count).toBeGreaterThan(0));
  it('다음 달 생일인 고객 5명', () => expect(ask('다음 달 생일인 고객 알려줘').res.count).toBe(5));
  it('해산물 못 드시는 분 → 김도현', () => expect(n('해산물 못 드시는 분')).toEqual(['김도현']));
  it('골프 좋아하는 은행 담당자 → 김도현', () => expect(n('골프 좋아하는 은행 담당자 찾아줘')).toEqual(['김도현']));
  it('정부기관 담당자 3명', () => expect(ask('정부기관 고객').res.count).toBe(3));
  it('미처리 요청이 있는 사람', () => expect(ask('미처리 요청이 있는 사람').res.count).toBeGreaterThan(0));
  it('한식 좋아하는 사람 3명', () => expect(n('한식 좋아하는 사람')).toEqual(['김도현', '오정석', '정민수']));
  it('최근 3개월 만나지 못한 고객 9명', () => expect(ask('최근 3개월 동안 만나지 못한 고객은?').res.count).toBe(9));
  it('우주선 타는 사람 0건', () => expect(ask('우주선 타는 사람').res.count).toBe(0));
  it('README 예시 6개 건수(1·9·5·2·4명, 요청 8건)', () => {
    const qs = ['골프 좋아하는 은행 담당자 찾아줘', '최근 3개월 동안 만나지 못한 고객은?', '다음 달 생일인 고객 알려줘', 'CMS 운영시간 확대에 관심을 보인 고객은?', '지난번에 자료를 요청했던 고객은 누구야?', '아직 처리하지 못한 요청사항을 모두 보여줘'];
    expect(qs.map((q) => ask(q).res.count)).toEqual([1, 9, 5, 2, 4, 8]);
  });
  it('고객 이름이 질문에 있어도 다른 조건 질문은 그대로(이름 목록에 있는 이름만 인식)', () => {
    expect(ask('김도현이 좋아하는 음식').cond.nameKeywords).toEqual(['김도현']);
    expect(ask('새빛학원').cond.nameKeywords).toEqual([]);
  });
});

describe('묻기: 군더더기 낱말은 AND하지 않는다', () => {
  it('조사·어미·날짜 말을 붙여도 0건이 되지 않는다', () => {
    expect(who('이번 주에 만나는 사람 누구야')).toEqual(['김도현', '장태우']);
    expect(who('수수료 누구야')).toEqual(who('수수료'));
    expect(who('오정석 언제야')).toEqual(['오정석']);
    expect(ask('수수료 누구야').cond.keywords.map((k) => k.text)).toEqual(['수수료']);
  });
});

describe('묻기: 고객이 없을 때와 AI 전송 가림', () => {
  it('고객이 0명이면 「등록된 고객이 없습니다」', async () => {
    const r = await searchQuestion(emptyAssistant(), '골프 좋아하는 사람', NOW);
    if ('error' in r) throw new Error(r.error);
    expect(r.count).toBe(0);
    expect(r.note).toBe(NO_CUSTOMERS_NOTE);
    expect(NO_CUSTOMERS_NOTE).toBe('등록된 고객이 없습니다');
    const ok = await searchQuestion(a, '골프 좋아하는 사람', NOW);
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.note).toBe('');
  });
  it('묻기 질문을 AI에 보낼 때도 전화번호·이메일·주민번호·계좌번호를 가린다', () => {
    const p = aiQuestionPrompt('010-1234-5678 번호 주인이 누구야, a.b@x.co.kr 은? 900101-1234567 / 110-123-456789', NOW);
    expect(p).not.toMatch(/1234-5678|a\.b@|900101|456789/);
    expect(p).toContain('[휴대전화]');
    expect(p).toContain('[이메일]');
    expect(p).toContain('[주민등록번호]');
    expect(p).toContain('[번호]');
    expect(aiQuestionPrompt('골프 좋아하는 은행 담당자', NOW)).toContain('질문: 골프 좋아하는 은행 담당자');
  });
});
