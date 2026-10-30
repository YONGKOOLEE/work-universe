// 재검증(2026-10-30) 지적 중 묻기(nlsearch)의 회귀 시험 — 재현 입력이 원하는 결과가 되는지, 맞던 결과는 그대로인지. 가상 데이터만.
import { describe, expect, it } from 'vitest';
import { createAssistantSeed } from '../src/assistant/seed';
import { NOT_UNDERSTOOD_NOTE, NO_CUSTOMERS_NOTE, describeCond, emptyCond, executeSearch, findName, ruleParse, searchQuestion } from '../src/assistant/nlsearch';
import { emptyAssistant } from '../src/assistant/model';

const NOW = new Date(2026, 9, 30, 10, 0, 0); // 2026-10-30 10:00 (금)
const a = createAssistantSeed(NOW, 'U1');
const names = a.customers.map((c) => c.name);
const ask = (q: string, list: readonly string[] = names) => {
  const cond = ruleParse(q, NOW, list);
  return { cond, res: executeSearch(a, cond, NOW), explain: describeCond(cond) };
};
const who = (q: string) => ask(q).res.customers.map((c) => c.name).sort();
const ev = (q: string, name: string) => ask(q).res.customers.find((c) => c.name === name)!.evidence.map((e) => `${e.label}:${e.text}`);
const outcome = async (q: string) => {
  const r = await searchQuestion(a, q, NOW);
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('재검증 1: 이름을 질문에서 빼고 남는 말로 읽는다 — 이름이 키워드로 들어가 0명이 되지 않는다', () => {
  it.each([
    ['김도현 못 먹는 음식', '김도현', '기피 음식:해산물'],
    ['김도현이 싫어하는 음식', '김도현', '기피 음식:해산물'],
    ['김도현 좋아하는 음식', '김도현', '선호 음식:한식'],
    ['김도현 관심사', '김도현', '취미·관심사:골프, 등산'],
    ['정민수 싫어하는 음식', '정민수', '기피 음식:매운 음식'],
  ])('%s → 그 고객 1명, 키워드 없이 칸을 근거로 표시', (q, name, line) => {
    const x = ask(q);
    expect(x.res.customers.map((c) => c.name)).toEqual([name]);
    expect(x.cond.nameKeywords).toEqual([name]);
    expect(x.cond.keywords).toEqual([]);
    expect(x.cond.conversationKeywords).toEqual([]);
    expect(ev(q, name)).toContain(line);
    expect(x.cond.show.length).toBe(1);
  });
  it('기피 음식 칸이 비어 있으면 「미입력」으로 보인다(없는 값을 만들지 않는다)', () => {
    expect(ev('윤지아 싫어하는 음식', '윤지아')).toContain('기피 음식:미입력');
  });
});

describe('재검증 2: 이름이 있어도 남은 낱말은 조건으로 함께 검사한다', () => {
  it.each(['이서연 골프 좋아해?', '이서연 골프'])('%s → 0명 + 「이서연 고객에게서 \'골프\'를 찾지 못했습니다」', async (q) => {
    const x = ask(q);
    expect(x.res.count).toBe(0);
    expect(x.cond.nameKeywords).toEqual(['이서연']);
    expect(x.cond.keywords.map((k) => k.text)).toEqual(['골프']);
    const o = await outcome(q);
    expect(o.count).toBe(0);
    expect(o.note).toBe("이서연 고객에게서 '골프'를 찾지 못했습니다");
  });
  it('실제 있는 낱말은 근거와 함께 찾는다: 최유진 파스타 → 선호 음식 칸', () => {
    expect(who('최유진 파스타')).toEqual(['최유진']);
    expect(ev('최유진 파스타', '최유진')).toContain('선호 음식:양식, 파스타');
    expect(who('이서연 요가')).toEqual(['이서연']);
  });
  it.each([
    ['김도현 기피 음식', '기피 음식:해산물'],
    ['김도현 취미', '취미·관심사:골프, 등산'],
    ['김도현님 부서', '부서:자금결제부'],
    ['김도현 미팅', '예정 미팅:2026-11-01 정기 업무협의 (예정)'],
    ['김도현 메일', '이메일:dh.kim@gaon-bank.example'],
    ['김도현 이메일', '이메일:dh.kim@gaon-bank.example'],
  ])('%s → 그 칸·활동을 근거에 표시(show)', (q, line) => {
    const x = ask(q);
    expect(x.res.customers.map((c) => c.name)).toEqual(['김도현']);
    expect(x.cond.show.length).toBe(1);
    expect(x.cond.keywords).toEqual([]);
    expect(ev(q, '김도현')).toContain(line);
  });
  it('김도현 미팅은 지난 미팅도 함께 보인다', () => {
    expect(ev('김도현 미팅', '김도현').some((l) => l.startsWith('최근 미팅 2026-10-17'))).toBe(true);
  });
  it('이전 시험의 이름 질문은 그대로: 오정석 생일 언제야 · 김도현 연락처 · 오정석 언제야', () => {
    expect(ask('오정석 생일 언제야').cond.show).toEqual(['birthday']);
    expect(ask('김도현 연락처').cond.show).toEqual(['contact']);
    expect(who('오정석 언제야')).toEqual(['오정석']);
  });
});

describe('재검증 3: 기간 말 + 미팅·일정은 예정 미팅, 조건이 비면 전체를 돌려주지 않는다', () => {
  it.each([
    ['오늘 미팅', '2026-10-30', '2026-10-30', []],
    ['내일 미팅', '2026-10-31', '2026-10-31', ['장태우']],
    ['이번 주 미팅', '2026-10-30', '2026-11-06', ['김도현', '장태우']],
    ['다음 주 미팅', '2026-11-02', '2026-11-08', []],
    ['이번 주 일정', '2026-10-30', '2026-11-06', ['김도현', '장태우']],
    ['이번 달 일정', '2026-10-30', '2026-10-31', ['장태우']],
  ])('%s → 예정 미팅(전체 18명이 아니다)', (q, from, to, expected) => {
    const x = ask(q);
    expect(x.cond.meetingFrom).toBe(from);
    expect(x.cond.meetingTo).toBe(to);
    expect(x.cond.keywords).toEqual([]);
    expect(who(q)).toEqual(expected);
  });
  it.each(['미팅', '주요 고객', '일정', '고객'])('%s → 이해하지 못했다고 안내하고 전체를 돌려주지 않는다', async (q) => {
    expect(ask(q).res.count).toBe(0);
    const o = await outcome(q);
    expect(o.count).toBe(0);
    expect(o.note).toBe(NOT_UNDERSTOOD_NOTE);
    expect(o.note.startsWith('질문을 이해하지 못했습니다. 예: ')).toBe(true);
  });
  it('「주요」는 어미를 잘못 뗀 낱말로 조건이 되지 않는다', () => {
    expect(ask('주요 고객').cond.keywords).toEqual([]);
  });
  it.each(['모든 고객', '전체 고객', '고객 전체', '모든 고객 보여줘'])('%s → 전체', (q) => {
    expect(ask(q).res.count).toBe(18);
    expect(ask(q).explain).toEqual(['조건 없음 — 전체']);
  });
  it('질문이 진짜 비었을 때만 전체(조건 객체의 all)', () => {
    expect(ruleParse('', NOW, names).all).toBe(true);
    expect(executeSearch(a, ruleParse('', NOW, names), NOW).count).toBe(18);
    expect(executeSearch(a, emptyCond(), NOW).count).toBe(0); // all 없는 빈 조건(AI가 아무것도 못 읽은 경우)
  });
  it('고객이 0명이면 안내는 「등록된 고객이 없습니다」가 우선', async () => {
    const r = await searchQuestion(emptyAssistant(), '미팅', NOW);
    if ('error' in r) throw new Error(r.error);
    expect(r.note).toBe(NO_CUSTOMERS_NOTE);
  });
});

describe('재검증 9a: 이름 인식 경계 — 이름 뒤가 공백·조사·호칭·끝일 때만', () => {
  const list = ['유진', '하나', '김도현', '최유진'];
  it('유진증권 담당자 · 하나은행 담당자 → 소속 검색(이름 아님)', () => {
    for (const [q, org] of [['유진증권 담당자', '증권'], ['하나은행 담당자', '은행']] as const) {
      const c = ruleParse(q, NOW, list);
      expect(c.nameKeywords).toEqual([]);
      expect(c.orgKeywords).toEqual([org]);
    }
  });
  it('이름 뒤가 끝·공백·조사·호칭이면 이름', () => {
    expect(findName('김도현', '김도현')).toEqual([0, 3]);
    expect(findName('김도현 연락처', '김도현')).toEqual([0, 3]);
    expect(findName('김도현이 싫어하는', '김도현')).toEqual([0, 4]);
    expect(findName('김도현님 부서', '김도현')).toEqual([0, 4]);
    expect(findName('김도현에게서 받은', '김도현')).toEqual([0, 6]);
    expect(findName('김도현?', '김도현')).toEqual([0, 3]);
    expect(findName('김도현증권', '김도현')).toBeNull();
    expect(findName('새김도현', '김도현')).toBeNull();
    expect(ruleParse('최유진 파스타', NOW, list).nameKeywords).toEqual(['최유진']); // 「유진」은 최유진 속 글자
  });
});

describe('재검증: 맞던 결과는 그대로', () => {
  it('README 예시 6개 1·9·5·2·4명·8건', () => {
    const qs = ['골프 좋아하는 은행 담당자 찾아줘', '최근 3개월 동안 만나지 못한 고객은?', '다음 달 생일인 고객 알려줘', 'CMS 운영시간 확대에 관심을 보인 고객은?', '지난번에 자료를 요청했던 고객은 누구야?', '아직 처리하지 못한 요청사항을 모두 보여줘'];
    expect(qs.map((q) => ask(q).res.count)).toEqual([1, 9, 5, 2, 4, 8]);
  });
  it('해산물 못 드시는 분 1명 · 이번 달에 챙겨야 할 사람 4명', () => {
    expect(who('해산물 못 드시는 분')).toEqual(['김도현']);
    expect(ask('이번 달에 내가 챙겨야 할 사람 누구야').res.count).toBe(4);
  });
  it('이름 없는 질문 · 낱말 검색은 그대로', () => {
    expect(ask('수수료').res.count).toBe(2);
    expect(ask('새빛학원').res.count).toBe(1);
    expect(ask('우주선 타는 사람').res.count).toBe(0);
    expect(who('이번 주에 만나는 사람')).toEqual(['김도현', '장태우']);
  });
});
