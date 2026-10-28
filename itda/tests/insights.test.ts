// 인계 위험 인사이트(유니버스 규칙 → 업무잇다 ID)
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { handoverInsights } from '../src/universe/insights';

describe('인계 위험 인사이트', () => {
  it('시연 데이터 팀 지도: 결과 출력', () => {
    const s = createSeed('linked');
    const r = handoverInsights(s, { kind: 'all' }, '2026-10-29');

    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe('인계 위험 인사이트 — 규칙별', () => {
  const s = createSeed('linked');
  const r = handoverInsights(s, { kind: 'all' }, '2026-10-29');
  const of = (k: string) => r.items.filter((x) => x.kind === k);
  it('다섯 가지가 모두 나오고 근거가 업무잇다 ID로 돌아온다', () => {
    expect(Object.values(r.counts).every((n) => n > 0)).toBe(true);
    for (const x of r.items) expect(x.workIds.length + x.userIds.length).toBeGreaterThan(0);
  });
  it('일 몰린 사람 = 지금 업무 3개를 맡은 정하준, 담당자 빈 업무 = 재배치로 담당이 끝난 W-010', () => {
    expect(of('dense').map((x) => x.userIds[0])).toEqual(['U5']);
    expect(of('gap').map((x) => x.workIds[0])).toEqual(['W-010']);
    expect(of('gap')[0].detail).toContain('강예린');
  });
  it('길목 업무: 선후행으로 이어진 업무(W-004 → W-008)', () => {
    expect(of('bottleneck').some((x) => x.workIds.includes('W-004') && x.workIds.includes('W-008'))).toBe(true);
  });
  it('담당을 한 사람 더 붙이면 혼자만 아는 일에서 빠진다', () => {
    const t = createSeed('linked');
    t.works.find((w) => w.id === 'W-004')!.owners.push('U6');
    t.works.find((w) => w.id === 'W-004')!.ownerHistory.push({ userId: 'U6', from: '2026-10-01', to: null });
    const r2 = handoverInsights(t, { kind: 'all' }, '2026-10-29');
    expect(r2.items.some((x) => x.kind === 'solo' && x.workIds[0] === 'W-004')).toBe(false);
  });
  it('내 지도 범위는 내 업무만 센다', () => {
    const mine = handoverInsights(s, { kind: 'mine', userId: 'U5' }, '2026-10-29');
    const myWorks = new Set(s.works.filter((w) => w.owners.includes('U5')).map((w) => w.id));
    for (const x of mine.items.filter((i) => i.kind === 'solo')) expect(myWorks.has(x.workIds[0])).toBe(true);
  });
  it('업무가 없으면 사유만', () => {
    const e = createSeed('fresh');
    const r3 = handoverInsights(e, { kind: 'all' }, '2026-10-29');
    expect(r3.items).toEqual([]);
    expect(r3.notes.length).toBe(1);
  });
});
