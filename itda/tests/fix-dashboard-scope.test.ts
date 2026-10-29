// H-1: 대시보드 숫자·인사이트 범위는 사용자 소속 조직(하위 포함)
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { myOrgScope, worksOfOrg } from '../src/lib/orgs';
import { handoverInsights } from '../src/universe/insights';

const s = createSeed('linked', new Date('2026-10-29T00:00:00Z'));
const byName = (n: string) => s.users.find((u) => u.name === n)!;

describe('대시보드 범위(H-1)', () => {
  it('팀장 박지훈: 소속 팀의 업무만 센다(회사 전체가 아님)', () => {
    const lead = byName('박지훈');
    const r = myOrgScope(s, lead.id);
    expect(r.org).not.toBeNull();
    expect(r.name).not.toMatch(/가상/);
    expect(r.works.length).toBeLessThan(s.works.length);
    expect(r.works.every((w) => w.dept.trim() === lead.dept.trim())).toBe(true);
    expect(r.works.length).toBe(worksOfOrg(s, r.org!.id).length);
    console.log('팀', r.name, r.works.length, '/ 전체', s.works.length);
  });
  it('소속이 부인 사람(서지안): 그 부와 아래 팀 업무', () => {
    const r = myOrgScope(s, byName('서지안').id);
    expect(r.org?.level).toBe('부');
    expect(r.works.length).toBeGreaterThan(myOrgScope(s, byName('박지훈').id).works.length);
    expect(r.works.length).toBeLessThanOrEqual(s.works.length);
  });
  it('소속 조직이 없으면 전체', () => {
    const t = createSeed('linked', new Date('2026-10-29T00:00:00Z'));
    t.users[0].dept = '';
    const r = myOrgScope(t, t.users[0].id);
    expect(r.org).toBeNull();
    expect(r.works.length).toBe(t.works.length);
  });
  it('팀 범위 인사이트가 계산되고 점검 도구(check 7)가 보는 「혼자만 아는 일」이 남는다', () => {
    const lead = byName('박지훈');
    const { org } = myOrgScope(s, lead.id);
    const ins = handoverInsights(s, { kind: 'org', orgId: org!.id }, '2026-10-29');
    console.log('팀 인사이트', ins.items.length, ins.counts);
    expect(ins.items.length).toBeGreaterThan(0);
    expect(ins.counts.solo).toBeGreaterThan(0);
  });
});
