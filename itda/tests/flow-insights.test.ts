// 업무 흐름·반복 인사이트(인계 사슬·같은 주제 반복·인계 준비도 낮음·유사 경험자)와 「한눈에」 한 줄
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { worksInScope } from '../src/universe/derive';
import { handoverInsights } from '../src/universe/insights';
import { FLOW_KINDS, flowInsights, overview, READINESS_LOW } from '../src/universe/flowInsights';
import { orgShort } from '../src/lib/orgs';

const AS_OF = '2026-10-29';
const NOW = new Date('2026-10-29T09:00:00Z');
const s = createSeed('linked', NOW);
const TEAM = { kind: 'all' as const };
const f = flowInsights(s, TEAM, AS_OF);
const of = (k: string, r = f) => r.items.filter((x) => x.kind === k);

describe('업무 흐름·반복 — 팀 전체(시연 데이터)', () => {
  it('종류별 개수가 목록과 맞고, 근거는 업무잇다 ID로 돌아온다', () => {
    for (const k of FLOW_KINDS) expect(f.counts[k]).toBe(of(k).length);
    for (const x of f.items) {
      expect(x.workIds.length).toBeGreaterThan(0);
      expect(x.evidence.length).toBeGreaterThan(0);
    }
  });
  it('인계 준비도 낮음: 6점 중 기준 이하만, 빠진 항목을 말한다', () => {
    expect(f.counts.low_readiness).toBeGreaterThan(0);
    for (const x of of('low_readiness')) {
      const n = Number(x.detail.match(/인계 준비 (\d)\/6/)![1]);
      expect(n).toBeLessThanOrEqual(READINESS_LOW);
      expect(x.detail).toContain('빠진 것:');
    }
  });
  it('유사 경험자: 업무마다, 직접 해 본 이전 담당이 있으면 맨 앞(자동이체 오류 대응 매뉴얼 ← 강예린)', () => {
    const x = of('similar').find((i) => i.title === '자동이체 오류 대응 매뉴얼 정비')!;
    expect(x.detail.startsWith('직접 해 본 이전 담당: 강예린')).toBe(true);
    expect(x.userIds.length).toBeGreaterThan(0);
    expect(x.workIds[0]).toMatch(/^W-/);
  });
  it('같은 주제 반복: 진행 사항이 둘 이상 업무에 되풀이된 주제(정산)', () => {
    const x = of('topic_repeat').find((i) => i.title === '주제 「정산」')!;
    expect(x).toBeTruthy();
    expect(x.workIds.length).toBeGreaterThanOrEqual(2);
  });
  it('인계 사슬: 같은 업무가 두 번 인계되면 나온다(시연 데이터에는 0건이라 인계 한 건을 더해 확인)', () => {
    expect(f.counts.handover_chain).toBe(0);
    const t = createSeed('linked', NOW);
    const ho = t.handovers.find((h) => h.workId === 'W-007' && h.status === 'confirmed')!;
    t.handovers.push({ ...ho, id: 'HO-T2', fromId: ho.toId, toId: ho.fromId, confirmedAt: '2026-10-20T09:00:00+09:00', baseDate: '2026-10-20' });
    const r = flowInsights(t, TEAM, AS_OF);
    const c = of('handover_chain', r);
    expect(c.length).toBe(1);
    expect(c[0].workIds).toEqual(['W-007']);
    expect(c[0].detail).toContain('2번 인계됨');
    // 담당이 아닌 사람의 내 지도에는 나오지 않는다
    expect(of('handover_chain', flowInsights(t, { kind: 'mine', userId: 'U3' }, AS_OF)).length).toBe(0);
  });
  it('같은 입력이면 같은 결과(결정적)', () => {
    expect(flowInsights(createSeed('linked', NOW), TEAM, AS_OF)).toEqual(f);
  });
  it('업무가 없으면 사유만', () => {
    const r = flowInsights(createSeed('fresh'), TEAM, AS_OF);
    expect(r.items).toEqual([]);
    expect(r.notes.length).toBe(1);
  });
});

describe('업무 흐름·반복 — 범위 거르기', () => {
  it('내 지도: 내 업무만(주제 반복은 내 업무 둘 이상일 때만)', () => {
    for (const u of ['U1', 'U3', 'U5']) {
      const mine = new Set(s.works.filter((w) => w.owners.includes(u)).map((w) => w.id));
      const r = flowInsights(s, { kind: 'mine', userId: u }, AS_OF);
      for (const x of r.items) {
        expect(mine.has(x.workIds[0])).toBe(true);
        if (x.kind === 'topic_repeat') expect(x.workIds.length).toBeGreaterThanOrEqual(2);
      }
      for (const k of FLOW_KINDS) expect(r.counts[k]).toBe(of(k, r).length);
    }
  });
  it('내 지도(정하준)는 팀 전체보다 많지 않다', () => {
    const r = flowInsights(s, { kind: 'mine', userId: 'U5' }, AS_OF);
    expect(r.items.length).toBeLessThanOrEqual(f.items.length);
  });
  it('조직 지도: 그 조직(아래 포함) 업무의 항목만', () => {
    const org = s.orgs!.find((o) => orgShort(o.name) === '디지털신원팀')!;
    const scope = { kind: 'org' as const, orgId: org.id };
    const ids = new Set(worksInScope(s, scope).map((w) => w.id));
    const r = flowInsights(s, scope, AS_OF);
    expect(r.items.length).toBeGreaterThan(0);
    for (const x of r.items) expect(ids.has(x.workIds[0])).toBe(true);
    expect(r.items.length).toBeLessThan(f.items.length);
  });
});

describe('한눈에 한 줄', () => {
  const r = handoverInsights(s, TEAM, AS_OF);
  const ov = overview(s, TEAM, r, f);
  it('업무 수·높은 위험·가장 많이 맡은 사람·주제·외부기관을 데이터에서 센다', () => {
    expect(ov.works).toBe(s.works.length);
    expect(ov.high).toBe([...r.items, ...f.items].filter((x) => x.level === 'high').length);
    expect(ov.people).toEqual([{ name: '정하준', count: 3 }]);
    const settle = s.works.filter((w) => (w.topics || []).includes('정산')).length;
    expect(ov.topics[0]).toEqual({ name: '정산', count: settle });
    expect(ov.text).toContain(`업무 ${s.works.length}개 · 높은 위험 ${ov.high}건`);
    expect(ov.text).toContain(`정산(${settle}개)`);
    expect(ov.agencies.every((a) => a.count >= 2)).toBe(true);
  });
  it('같은 입력이면 같은 문장', () => {
    expect(overview(createSeed('linked', NOW), TEAM, r, f).text).toBe(ov.text);
  });
  it('내 지도는 내 업무 기준, 업무가 없는 사람은 0개', () => {
    const sc = { kind: 'mine' as const, userId: 'U1' };
    const mine = overview(s, sc, handoverInsights(s, sc, AS_OF), flowInsights(s, sc, AS_OF));
    expect(mine.works).toBe(s.works.filter((w) => w.owners.includes('U1')).length);
    const none = overview(s, { kind: 'mine', userId: 'U-NONE' }, { items: [], counts: {} as any, notes: [] }, { items: [], counts: {} as any, notes: [] });
    expect(none.text).toBe('업무 0개 · 높은 위험 0건');
  });
});
