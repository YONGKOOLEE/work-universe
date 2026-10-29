// Claude 결과 검증 강화(검토 B H-1·M-1·L-7): 모델이 쓴 문장은 「원문 확인」이 아니다, 앱이 조립한 줄은 근거가 아니다, 상투 문구 돌려쓰기 차단, 인용은 원문 구간으로 저장
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { scopeFor } from '../src/lib/store';
import { createClient } from '../src/ai/llm';
import { claudeAsk, ASK_SYSTEM, unsupportedNumbers } from '../src/ai/claudeSearch';
import { buildInsightInput, verifyInsights, verifyRef, INSIGHT_SYSTEM, QUOTE_MIN } from '../src/ai/aiInsight';
import { verifyOverall, OVERALL_SYSTEM } from '../src/ai/aiOverall';
import { buildCheckInput, verifyFindings, CHECK_SYSTEM } from '../src/ai/aiCheck';
import { spanOf } from '../src/ai/reflect';

const AS_OF = '2026-10-29';
const TEAM = { kind: 'all' as const };
const fake = (output: unknown) => createClient('test', 'fake-model', { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: output }) } });

describe('H-1 AI 검색: Claude 문장에 「원문 확인」(fact)을 주지 않는다', () => {
  const mk = () => {
    const s = createSeed('linked');
    s.docs[0].workIds = s.works.map((w) => w.id); // 질문이 특정 업무로 좁혀져도 이 문서가 남도록
    s.docs[0].paragraphs = [{ id: 'zz-1', text: '예산 검토 회의를 열었다. 세부 항목은 다음 회의에서 정하기로 했다.' }];
    return { s, docId: s.docs[0].id };
  };
  const ask = (s: ReturnType<typeof mk>['s'], line: unknown) => claudeAsk(fake({ lines: [line], eventIds: [], workIds: [], followups: [] }) as any, s, '예산 검토 회의 내용은?');

  it('인용 「예산 검토 회의」(공백 제외 6자)로 「예산은 5억 원으로 확정」을 내면 fact가 아니고, 인용 최소 길이 미달이라 근거도 인정하지 않는다', async () => {
    const { s, docId } = mk();
    const r = await ask(s, { text: '예산은 5억 원으로 확정되었습니다.', basis: 'source', cites: [{ docId, paraId: 'zz-1', quote: '예산 검토 회의' }] });
    expect(r.lines[0].prov).not.toBe('fact');
    expect(r.lines[0].prov).toBe('unverified');
    expect(r.verify.passed).toBe(0);
  });
  it('인용이 충분히 길어도(12자 이상) 문장은 fact가 아니라 inference + 근거 링크', async () => {
    const { s, docId } = mk();
    const r = await ask(s, { text: '예산 검토 회의를 열고 세부 항목은 다음 회의에서 정하기로 했습니다.', basis: 'source', cites: [{ docId, paraId: 'zz-1', quote: '세부 항목은 다음 회의에서 정하기로 했다' }] });
    expect(r.lines[0].prov).toBe('inference');
    expect(r.lines[0].cite?.[0]).toMatchObject({ docId, anchor: 'zz-1' });
    expect(r.evidence[0].quote).toBe('세부 항목은 다음 회의에서 정하기로 했다');
  });
  it('문장 속 숫자가 인용·근거 문단에 없으면 unverified로 낮추고 근거 링크도 붙이지 않는다', async () => {
    const { s, docId } = mk();
    const r = await ask(s, { text: '예산은 5억 원으로 하고 세부 항목은 다음 회의에서 정하기로 했습니다.', basis: 'source', cites: [{ docId, paraId: 'zz-1', quote: '세부 항목은 다음 회의에서 정하기로 했다' }] });
    expect(r.lines[0].prov).toBe('unverified');
    expect(r.lines[0].cite).toBeUndefined();
    expect(r.evidence).toEqual([]);
  });
  it('저장하는 인용은 모델 문자열이 아니라 원문 구간(띄어쓰기 차이 복원)', async () => {
    const { s, docId } = mk();
    const r = await ask(s, { text: '세부 항목은 다음 회의에서 정합니다.', basis: 'source', cites: [{ docId, paraId: 'zz-1', quote: '세부항목은다음회의에서정하기로했다' }] });
    expect(r.evidence[0].quote).toBe('세부 항목은 다음 회의에서 정하기로 했다');
  });
  it('basis가 inference·unknown이면 인용이 없어도 각각 inference·unverified, fact는 어디에도 없다', async () => {
    const { s } = mk();
    const r = await claudeAsk(fake({ lines: [{ text: '종합하면 이렇습니다.', basis: 'inference', cites: [] }, { text: '확인할 수 없습니다.', basis: 'unknown', cites: [] }], eventIds: [], workIds: [], followups: [] }) as any, s, '예산 검토 회의 내용은?');
    expect(r.lines.map((l) => l.prov)).toEqual(['inference', 'unverified']);
  });
  it('unsupportedNumbers: 날짜는 정규화해서, 숫자는 쉼표를 빼고 비교', () => {
    expect(unsupportedNumbers('2026년 10월 1일까지 1,200건', ['2026. 10. 1.까지 접수 1200건'])).toEqual([]);
    expect(unsupportedNumbers('2026년 10월 2일까지', ['2026. 10. 1.까지'])).toEqual(['2026년 10월 2일']);
    expect(unsupportedNumbers('5억 원', ['예산 검토'])).toEqual(['5']);
    expect(unsupportedNumbers('숫자가 없는 문장', ['예산 5억'])).toEqual([]);
  });
  it('프롬프트의 인용 길이(12~120자)와 코드 상수가 같다', () => {
    expect(ASK_SYSTEM).toContain('12~120자');
    expect(INSIGHT_SYSTEM).toContain('12~120자');
    expect(OVERALL_SYSTEM).toContain('12~120자');
    expect(CHECK_SYSTEM).toContain('12~120자');
    expect(QUOTE_MIN).toBe(12);
  });
});

describe('M-1 인사이트·전체 인사이트·점검: 앱이 조립한 줄은 근거가 아니다', () => {
  const s = scopeFor(createSeed('linked'), 'U3');
  const inp = buildInsightInput(s, TEAM, AS_OF);
  const ins = (refs: { ref: string; quote: string }[]) => verifyInsights({ insights: [{ kind: 'gap', level: 'mid', title: '지어낸 위험', detail: '', refs, people: [] }] }, inp);

  it('「최근 갱신 2026. 10. 27.」(머리줄)만 인용하면 탈락', () => {
    const r = ins([{ ref: 'W-001#1', quote: '유형 정책·제도, 담당 김도윤, 최근 갱신 2026. 10. 27.' }]);
    expect(r.items).toEqual([]);
    expect(r.dropped).toBe(1);
  });
  it('연결 문서·담당 이력·상위/다음/관련 업무 줄 인용은 모두 탈락', () => {
    const w1 = inp.lines.get('W-001')!;
    const pick = (head: string) => {
      const i = w1.findIndex((l) => l.startsWith(head));
      expect(i).toBeGreaterThanOrEqual(0);
      return { ref: `W-001#${i + 1}`, quote: w1[i].slice(head.length + 1) };
    };
    for (const head of ['연결 문서', '담당 이력', '상위 업무', '다음 업무', '관련 업무']) expect(ins([pick(head)]).items, head).toEqual([]);
  });
  it('인계 상태 줄 인용도 탈락', () => {
    const t = createSeed('linked');
    const h = t.handovers[0];
    const i2 = buildInsightInput(scopeFor(t, h.fromId), TEAM, AS_OF);
    const ls = i2.lines.get(h.workId)!;
    const n = ls.findIndex((l) => l.startsWith(`인계 ${h.id}`)) + 1;
    expect(n).toBeGreaterThan(0);
    const r = verifyInsights({ insights: [{ kind: 'handover', level: 'mid', title: 't', detail: '', refs: [{ ref: `${h.workId}#${n}`, quote: ls[n - 1] }], people: [] }] }, i2);
    expect(r.items).toEqual([]);
  });
  it('조치사항은 본문 글만 근거, 담당·기한 부분은 탈락', () => {
    const w1 = inp.lines.get('W-001')!;
    const n = w1.findIndex((l) => l.startsWith('조치사항')) + 1;
    expect(ins([{ ref: `W-001#${n}`, quote: '참가기관 업무협의회에서 개선방안을 설명할 예정임' }]).items.length).toBe(1);
    expect(ins([{ ref: `W-001#${n}`, quote: '담당 김도윤, 기한 2026. 10. 20.' }]).items).toEqual([]);
  });
  it('프롬프트에 보내는 줄 끝에 인용 불가 표시가 붙고 줄 번호는 그대로', () => {
    expect(inp.user).toMatch(/\[W-001#1\] 업무명: .*\(참고용·인용 불가\)/);
    expect(inp.user).not.toMatch(/\[W-001#5\] .*\(참고용·인용 불가\)/);
  });
  it('최소 길이 12자(공백 제외): 11자는 탈락, 12자는 통과', () => {
    expect(verifyRef({ ref: 'W-001#5', quote: '비대면가입증가에따라영업' }, inp)).not.toBeNull(); // 12자
    expect(verifyRef({ ref: 'W-001#5', quote: '비대면가입증가에따라영' }, inp)).toBeNull(); // 11자
  });
  it('따옴표·가운뎃점 모양이 달라도 통과한다(오탈락 줄이기)', () => {
    const t = createSeed('linked');
    t.works[0].current = [{ ...t.works[0].current[0], text: '“외부기관” 회신은 ‘담당자ㆍ팀장’ 확인 후 보내기로 함' }];
    const i2 = buildInsightInput(scopeFor(t, 'U3'), TEAM, AS_OF);
    const id = t.works[0].id;
    const n = i2.lines.get(id)!.findIndex((l) => l.startsWith('현재 진행')) + 1;
    expect(verifyRef({ ref: `${id}#${n}`, quote: '"외부기관" 회신은 \'담당자·팀장\' 확인 후 보내기로 함' }, i2)).not.toBeNull();
    expect(verifyRef({ ref: `${id}#${n}`, quote: '"외부기관" 회신은 \'담당자・팀장\' 확인 후 보내기로 함' }, i2)).not.toBeNull();
  });
  it('L-7 저장하는 quote는 모델 문자열이 아니라 원문 구간', () => {
    const r = verifyRef({ ref: 'W-001#5', quote: '비대면가입증가에따라영업점방문없이' }, inp)!;
    expect(r.quote).toBe('비대면 가입 증가에 따라 영업점 방문 없이');
    expect(spanOf('가 나  다', '나다')).toBe('나  다');
  });

  describe('전체 인사이트', () => {
    const f = (evidence: { line: string; quote: string }[]) => ({ title: '관통', insight: '흐름', why: '', suggestion: '', evidence });
    const withSame = (text: string) => {
      const t = createSeed('linked');
      for (const id of ['W-001', 'W-004']) t.works.find((w) => w.id === id)!.current = [{ ...t.works[0].current[0], text }];
      const i2 = buildInsightInput(scopeFor(t, 'U3'), TEAM, AS_OF);
      const n = (id: string) => `${id}#${i2.lines.get(id)!.findIndex((l) => l.startsWith('현재 진행')) + 1}`;
      return { i2, n };
    };
    it('두 업무가 같은 상투 문구를 인용하면 탈락(본문·머리줄 모두)', () => {
      const { i2, n } = withSame('담당자 확인을 거쳐 진행하는 것이 원칙임');
      const q = '담당자 확인을 거쳐 진행하는 것이 원칙임';
      const same = verifyOverall({ findings: [f([{ line: n('W-001'), quote: q }, { line: n('W-004'), quote: q }])] }, i2);
      expect(same.items).toEqual([]);
      expect(same.dropped).toBe(1);
      const head = verifyOverall({ findings: [f([{ line: 'W-001#1', quote: '유형 미상, 담당 김가나' }, { line: 'W-004#1', quote: '유형 미상, 담당 김가나' }])] }, i2);
      expect(head.items).toEqual([]);
    });
    it('공백·따옴표만 다른 같은 인용도 같은 것으로 센다', () => {
      const { i2, n } = withSame('“담당자 확인”을 거쳐 진행하는 것이 원칙임');
      const r = verifyOverall({ findings: [f([{ line: n('W-001'), quote: '"담당자 확인"을 거쳐 진행하는 것이 원칙임' }, { line: n('W-004'), quote: '“담당자확인”을 거쳐 진행하는 것이 원칙임' }])] }, i2);
      expect(r.items).toEqual([]);
    });
    it('서로 다른 인용이면 통과', () => {
      const ok = verifyOverall({ findings: [f([{ line: 'W-001#5', quote: inp.lines.get('W-001')![4].slice(0, 20) }, { line: 'W-004#5', quote: inp.lines.get('W-004')![4].slice(0, 20) }])] }, inp);
      expect(ok.items.length).toBe(1);
    });
  });
});

describe('M-1 점검: 앱이 조립한 줄은 근거가 아니다', () => {
  const s = createSeed('linked');
  const inp = buildCheckInput(s, 'W-007', new Date('2026-10-29T09:00:00+09:00'))!;
  const run = (quote: string, ref: string) => verifyFindings({ findings: [{ kind: 'conflict', severity: 'high', title: '문서와 담당이 다름', detail: '', quote, ref }] }, inp, s);
  it('조치사항의 「담당 윤재민, 기한 미지정」과 업무명 머리줄 인용은 탈락', () => {
    expect(run('담당 윤재민, 기한 미지정', '기록#9').findings).toEqual([]);
    expect(run('자동이체 오류 대응 매뉴얼 정비 (상태 진행 중', '기록#1').dropped).toBe(1);
  });
  it('조치사항 본문 글은 통과하고 quote는 원문 구간으로 저장', () => {
    const r = run('오류유형별대응절차채우기', '기록#9');
    expect(r.findings[0].quote).toBe('오류 유형별 대응 절차 채우기');
    expect(r.findings[0].recordLine).toContain('조치사항');
  });
  it('문서 문단 인용도 원문 구간으로 저장', () => {
    const para = inp.paras.get('D-105')!.find((p) => p.text.includes('재시도 횟수'))!;
    const r = run('재시도횟수기준은2026.11.20.까지참가기관과협의할계획', `D-105#${para.id}`);
    expect(r.findings[0].cite?.docId).toBe('D-105');
    expect(para.text).toContain(r.findings[0].quote);
  });
  it('보내는 줄에 인용 불가 표시', () => {
    expect(inp.user).toMatch(/\[기록#1\] 업무명: .*\(참고용·인용 불가\)/);
  });
});
