// Claude 인사이트(aiInsight): 입력 구성(범위·보내지 않는 것), 근거 인용 대조, 최대 개수 — 가짜 클라이언트로
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { scopeFor } from '../src/lib/store';
import { addPrivateMemo } from '../src/universe/commands';
import { AI_INSIGHT_MAX, buildInsightInput, claudeInsights, INSIGHT_SCHEMA, INSIGHT_SYSTEM, verifyInsights } from '../src/ai/aiInsight';
import { evidenceGids } from '../src/universe/insights';
import { createClient } from '../src/ai/llm';

const AS_OF = '2026-10-29';
const TEAM = { kind: 'all' as const };

function fakeClient(output: unknown, seen: any[] = []) {
  return createClient('test', 'fake-model', {
    messages: {
      parse: async (body: any) => {
        seen.push(body);
        return { stop_reason: 'end_turn', parsed_output: output };
      },
    },
  });
}
/** 그 업무 기록에서 글자를 찾아 [W-001#n] 위치 */
const refOf = (inp: ReturnType<typeof buildInsightInput>, workId: string, part: string) => {
  const n = inp.lines.get(workId)!.findIndex((l) => l.includes(part)) + 1;
  expect(n).toBeGreaterThan(0);
  return `${workId}#${n}`;
};

describe('Claude 인사이트 — 입력', () => {
  it('팀 범위: 업무마다 기록 줄 [W-…#n], 사람 [U…], 규칙 인사이트 제목을 함께 보낸다', () => {
    const s = createSeed('linked');
    const inp = buildInsightInput(scopeFor(s, 'U3'), TEAM, AS_OF);
    expect(inp.lines.size).toBe(s.works.length);
    expect(inp.user).toMatch(/\[W-001#1\] 업무명: /);
    expect(inp.user).toContain('[U1] 김도윤');
    expect(inp.user).toContain('<규칙 인사이트가 이미 찾은 것>');
    expect(inp.user).toMatch(/길목 업무: |혼자만 아는 일: /);
    expect(inp.user).toContain('다음 업무(이 업무 뒤에 함): ');
  });
  it('내 지도 범위: 내 담당 업무만', () => {
    const s = createSeed('linked');
    const inp = buildInsightInput(scopeFor(s, 'U1'), { kind: 'mine', userId: 'U1' }, AS_OF);
    const mine = s.works.filter((w) => w.owners.includes('U1')).map((w) => w.id);
    expect([...inp.lines.keys()].sort()).toEqual(mine.sort());
  });
  it('「나만 보기」 메모와 남의 확정 전 인계는 보내지 않는다', () => {
    const s = createSeed('linked');
    addPrivateMemo(s, 'W-001', 'U1', '비밀메모-팀장님께는-아직-말하지-않음', `${AS_OF}T09:00:00+09:00`);
    s.handovers.push({ ...s.handovers[0], id: 'HO-T9', workId: 'W-004', status: 'draft', fromId: 'U5', toId: 'U6', snapshotId: undefined } as any);
    for (const u of ['U1', 'U3']) {
      const inp = buildInsightInput(scopeFor(s, u), TEAM, AS_OF);
      expect(inp.user).not.toContain('비밀메모');
      expect(inp.user).not.toContain('HO-T9');
    }
    // 당사자에게는 진행 중 인계가 보인다(자기 범위)
    expect(buildInsightInput(scopeFor(s, 'U5'), TEAM, AS_OF).user).toContain('인계 HO-T9');
  });
  it('스키마는 모든 칸 필수 + 추가 칸 금지, 프롬프트에 지어내기·날짜 규칙', () => {
    const item = (INSIGHT_SCHEMA as any).properties.insights.items;
    expect(item.required.sort()).toEqual(['detail', 'kind', 'level', 'people', 'refs', 'title']);
    expect(item.additionalProperties).toBe(false);
    expect(item.properties.refs.items.additionalProperties).toBe(false);
    expect(INSIGHT_SYSTEM).toContain('지어내지 않습니다');
    expect(INSIGHT_SYSTEM).toContain('원문에 없는 날짜·기한·담당을 만들지 않습니다');
  });
});

describe('Claude 인사이트 — 근거 대조', () => {
  const s = scopeFor(createSeed('linked'), 'U3');
  const inp = buildInsightInput(s, TEAM, AS_OF);
  // 앱이 조립한 머리줄(1번)은 근거가 아니므로, 사람이 쓴 줄(W-001 5번 배경, W-004 5번 현재 진행)을 쓴다
  const w1 = inp.lines.get('W-001')![4];
  const w4 = inp.lines.get('W-004')![4];
  it('실제 기록 줄 인용은 통과, 지어낸 인용·범위 밖 업무·짧은 인용은 뺀다', () => {
    const r = verifyInsights(
      {
        insights: [
          { kind: 'dependency', level: 'high', title: '두 업무가 이어짐', detail: '함께 봐야 함', refs: [{ ref: 'W-001#5', quote: w1.slice(0, 20) }, { ref: 'W-004#5', quote: w4.slice(0, 20) }], people: ['U1', 'U99'] },
          { kind: 'deadline', level: 'mid', title: '지어낸 인용', detail: '', refs: [{ ref: 'W-001#5', quote: '이 문장은 기록 어디에도 없습니다 정말로' }], people: [] },
          { kind: 'gap', level: 'low', title: '범위 밖 업무', detail: '', refs: [{ ref: 'W-999#1', quote: w1.slice(0, 20) }], people: [] },
          { kind: 'gap', level: 'low', title: '짧은 인용', detail: '', refs: [{ ref: 'W-001#5', quote: '업무명' }], people: [] },
          { kind: 'nonsense', level: 'low', title: '모르는 종류', detail: '', refs: [{ ref: 'W-001#5', quote: w1.slice(0, 20) }], people: [] },
        ],
      },
      inp,
    );
    expect(r.items.map((x) => x.title)).toEqual(['두 업무가 이어짐']);
    expect(r.items[0].workIds).toEqual(['W-001', 'W-004']);
    expect(r.items[0].userIds).toEqual(['U1']); // 없는 사람은 뺀다
    expect(r.items[0].refs[0]).toMatchObject({ workId: 'W-001', lineNo: 5 });
    expect(r.dropped).toBe(3); // 모르는 종류는 버리되 「인용 미확인」으로 세지 않음
  });
  it('줄 번호가 틀려도 같은 업무 안에 인용이 있으면 그 줄로 고치고, 다른 업무 줄은 인정하지 않는다', () => {
    const at = refOf(inp, 'W-001', '증가에 따라');
    const r = verifyInsights({ insights: [{ kind: 'knowledge', level: 'mid', title: 't', detail: '', refs: [{ ref: '[W-001#99]', quote: w1.slice(3, 25) }], people: [] }] }, inp);
    expect(`W-001#${r.items[0].refs[0].lineNo}`).toBe(at);
    const r2 = verifyInsights({ insights: [{ kind: 'knowledge', level: 'mid', title: 't', detail: '', refs: [{ ref: 'W-004#5', quote: w1.slice(3, 25) }], people: [] }] }, inp);
    expect(r2.items.length).toBe(0);
    expect(r2.dropped).toBe(1);
  });
  it('근거 일부만 확인되면 확인된 근거만 남기고 항목은 살린다', () => {
    const r = verifyInsights({ insights: [{ kind: 'overlap', level: 'mid', title: '겹침', detail: '', refs: [{ ref: 'W-001#5', quote: w1.slice(0, 20) }, { ref: 'W-004#5', quote: '지어낸 문장이 여기에 들어 있습니다' }], people: [] }] }, inp);
    expect(r.items[0].refs.length).toBe(1);
    expect(r.items[0].workIds).toEqual(['W-001']);
    expect(r.dropped).toBe(0);
  });
  it(`최대 ${AI_INSIGHT_MAX}개, 높음부터`, () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: 'gap', level: i === 11 ? 'high' : 'low', title: `항목 ${i}`, detail: '', refs: [{ ref: 'W-001#5', quote: w1.slice(0, 20) }], people: [] }));
    const r = verifyInsights({ insights: many }, inp);
    expect(r.items.length).toBe(AI_INSIGHT_MAX);
    expect(r.items[0].level).not.toBe('high'); // 12번째는 상한 밖이라 들어오지 않음(앞에서부터 자름)
  });
  it('claudeInsights: 가짜 클라이언트 → 검증 결과, 요청은 insight 상한·스키마', async () => {
    const seen: any[] = [];
    const cli = fakeClient({ insights: [{ kind: 'dependency', level: 'high', title: '이어진 업무', detail: '확인 필요', refs: [{ ref: 'W-004#5', quote: w4.slice(0, 20) }], people: [] }, { kind: 'gap', level: 'low', title: '가짜', detail: '', refs: [{ ref: 'W-004#5', quote: '없는 문장입니다 정말로 없어요' }], people: [] }] }, seen);
    const r = await claudeInsights(cli, s, TEAM, AS_OF);
    expect(r.engine).toBe('claude');
    expect(r.items.length).toBe(1);
    expect(r.dropped).toBe(1);
    expect(seen[0].max_tokens).toBe(16000);
    expect(seen[0].system).toBe(INSIGHT_SYSTEM);
    expect(seen[0].messages[0].content).toContain('<업무 기록>');
  });
  it('근거 업무·사람을 지도 전역 ID로 바꾼다(지도에서 노랗게 강조)', () => {
    const g = evidenceGids(s, TEAM, ['W-001'], ['U1']);
    expect(g.length).toBeGreaterThanOrEqual(2);
  });
});
