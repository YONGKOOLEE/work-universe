// Claude 전체 인사이트(aiOverall): 근거 인용 대조·서로 다른 업무 둘 이상 요구·상한 — 가짜 클라이언트로
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { scopeFor } from '../src/lib/store';
import { addPrivateMemo } from '../src/universe/commands';
import { buildInsightInput } from '../src/ai/aiInsight';
import { claudeOverall, OVERALL_MAX, OVERALL_SCHEMA, OVERALL_SYSTEM, verifyOverall } from '../src/ai/aiOverall';
import { createClient, LIMITS } from '../src/ai/llm';

const AS_OF = '2026-10-29';
const TEAM = { kind: 'all' as const };

function fakeClient(output: unknown, seen: any[] = []) {
  return createClient('test', 'fake-model', {
    messages: {
      parse: async (body: any, opt?: any) => {
        seen.push({ ...body, __opt: opt });
        return { stop_reason: 'end_turn', parsed_output: output };
      },
    },
  });
}

const s = scopeFor(createSeed('linked'), 'U3');
const inp = buildInsightInput(s, TEAM, AS_OF);
// 앱이 조립한 머리줄(1번)은 근거가 아니므로 사람이 쓴 5번 줄을 인용한다
const q1 = inp.lines.get('W-001')![4].slice(0, 20);
const q4 = inp.lines.get('W-004')![4].slice(0, 20);
const finding = (title: string, evidence: { line: string; quote: string }[]) => ({ title, insight: '여러 업무에 걸친 흐름', why: '함께 늦어짐', suggestion: '먼저 한 곳에서 정리', evidence });

describe('Claude 전체 인사이트 — 근거 대조', () => {
  it('서로 다른 업무 둘 이상에서 확인된 근거 2줄 이상이면 남긴다', () => {
    const r = verifyOverall({ findings: [finding('두 업무를 관통', [{ line: 'W-001#5', quote: q1 }, { line: 'W-004#5', quote: q4 }])] }, inp);
    expect(r.items.length).toBe(1);
    expect(r.items[0].workIds).toEqual(['W-001', 'W-004']);
    expect(r.items[0].evidence.length).toBe(2);
    expect(r.dropped).toBe(0);
  });
  it('한 업무 안의 근거뿐이면 뺀다(전체를 관통하지 않음)', () => {
    const w1b = inp.lines.get('W-001')![1].slice(0, 20);
    const r = verifyOverall({ findings: [finding('한 업무 이야기', [{ line: 'W-001#5', quote: q1 }, { line: 'W-001#2', quote: w1b }])] }, inp);
    expect(r.items).toEqual([]);
    expect(r.dropped).toBe(1);
  });
  it('지어낸 인용·범위 밖 업무·짧은 인용은 근거로 세지 않아, 확인된 근거가 모자라면 뺀다', () => {
    const r = verifyOverall(
      {
        findings: [
          finding('인용 하나만 진짜', [{ line: 'W-001#5', quote: q1 }, { line: 'W-004#5', quote: '기록 어디에도 없는 문장입니다 정말로' }]),
          finding('범위 밖 업무', [{ line: 'W-001#5', quote: q1 }, { line: 'W-999#1', quote: q4 }]),
          finding('짧은 인용', [{ line: 'W-001#5', quote: q1 }, { line: 'W-004#5', quote: '업무명' }]),
          finding('진짜 둘', [{ line: 'W-001#5', quote: q1 }, { line: 'W-004#5', quote: q4 }]),
        ],
      },
      inp,
    );
    expect(r.items.map((x) => x.title)).toEqual(['진짜 둘']);
    expect(r.dropped).toBe(3);
  });
  it('줄 번호가 틀려도 같은 업무 안에 인용이 있으면 그 줄로 고친다', () => {
    const r = verifyOverall({ findings: [finding('줄 번호 오류', [{ line: '[W-001#99]', quote: q1 }, { line: 'W-004#5', quote: q4 }])] }, inp);
    expect(r.items[0].evidence[0]).toMatchObject({ workId: 'W-001', lineNo: 5 });
  });
  it('같은 줄을 두 번 써도 한 줄로 센다', () => {
    const r = verifyOverall({ findings: [finding('중복 근거', [{ line: 'W-001#5', quote: q1 }, { line: 'W-001#5', quote: q1 }])] }, inp);
    expect(r.items).toEqual([]);
  });
  it(`최대 ${OVERALL_MAX}개`, () => {
    const many = Array.from({ length: 9 }, (_, i) => finding(`항목 ${i}`, [{ line: 'W-001#5', quote: q1 }, { line: 'W-004#5', quote: q4 }]));
    expect(verifyOverall({ findings: many }, inp).items.length).toBe(OVERALL_MAX);
  });
  it('제목·내용이 없는 항목은 건너뛴다', () => {
    const r = verifyOverall({ findings: [{ title: '', insight: 'x', why: '', suggestion: '', evidence: [] }, { title: 'x', insight: '', evidence: [] } as any] }, inp);
    expect(r.items).toEqual([]);
  });
});

describe('Claude 전체 인사이트 — 요청', () => {
  it('스키마는 모든 칸 필수 + 추가 칸 금지, 프롬프트에 지어내기 금지·서로 다른 업무 근거', () => {
    const item = (OVERALL_SCHEMA as any).properties.findings.items;
    expect([...item.required].sort()).toEqual(['evidence', 'insight', 'suggestion', 'title', 'why']);
    expect(item.additionalProperties).toBe(false);
    expect([...item.properties.evidence.items.required].sort()).toEqual(['line', 'quote']);
    expect(OVERALL_SYSTEM).toContain('지어내지 않습니다');
    expect(OVERALL_SYSTEM).toContain('서로 다른 업무');
  });
  it('claudeOverall: overall 상한·스키마로 부르고 검증 결과를 돌려준다', async () => {
    const seen: any[] = [];
    const cli = fakeClient({ findings: [finding('공통 흐름', [{ line: 'W-001#5', quote: q1 }, { line: 'W-004#5', quote: q4 }]), finding('가짜', [{ line: 'W-004#5', quote: '없는 문장입니다 정말로 없어요' }])] }, seen);
    const r = await claudeOverall(cli, s, TEAM, AS_OF);
    expect(r.engine).toBe('claude');
    expect(r.items.length).toBe(1);
    expect(r.dropped).toBe(1);
    expect(seen[0].max_tokens).toBe(LIMITS.overall.maxTokens);
    expect(seen[0].system).toBe(OVERALL_SYSTEM);
    expect(seen[0].messages[0].content).toContain('<업무 기록>');
  });
  it('「나만 보기」 메모는 보내지 않는다', async () => {
    const t = createSeed('linked');
    addPrivateMemo(t, 'W-001', 'U1', '비밀메모-팀장님께는-아직-말하지-않음', `${AS_OF}T09:00:00+09:00`);
    const seen: any[] = [];
    await claudeOverall(fakeClient({ findings: [] }, seen), scopeFor(t, 'U3'), TEAM, AS_OF);
    expect(seen[0].messages[0].content).not.toContain('비밀메모');
  });
  it('중단 신호를 클라이언트에 넘긴다', async () => {
    const c = new AbortController();
    const seen: any[] = [];
    await claudeOverall(fakeClient({ findings: [] }, seen), s, TEAM, AS_OF, c.signal);
    expect(seen[0].__opt.signal).toBe(c.signal);
  });
});
