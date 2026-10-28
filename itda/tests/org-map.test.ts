// 조직 계층 지도(2026-10-29 사용자 결정: 업무 → 팀 → 부 → 본부 → 회사)
import { describe, it, expect } from 'vitest';
import { createSeed } from '../src/data/seed';
import { deriveMap, worksInScope } from '../src/universe/derive';
import { handoverInsights } from '../src/universe/insights';
import { myOrgChain, orgShort } from '../src/lib/orgs';
import type { AppState } from '../src/lib/types';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { projectView } from '../../app/src/view/collapse.js';

const NOW = '2026-10-29T09:00:00.000Z';
const s = createSeed('linked', new Date(NOW));
const org = (name: string) => s.orgs!.find((o) => orgShort(o.name) === name)!.id;
const labelsOf = (v: any, nodes: any[]) => nodes.map((n) => n.label);

describe('조직 범위 업무', () => {
  it('조직과 아래 조직의 업무를 센다', () => {
    expect(worksInScope(s, { kind: 'org', orgId: org('디지털신원팀') }).length).toBe(4);
    expect(worksInScope(s, { kind: 'org', orgId: org('전자금융부') }).length).toBe(11); // 두 팀 10 + 부 업무 1
    expect(worksInScope(s, { kind: 'org', orgId: org('결제서비스본부') }).length).toBe(13);
    expect(worksInScope(s, { kind: 'org', orgId: org('우리 기관') }).length).toBe(15);
  });
  it('내 조직 칩: 팀 → 부 → 본부 → 회사', () => {
    expect(myOrgChain(s, 'U1').map((o) => orgShort(o.name))).toEqual(['디지털신원팀', '전자금융부', '결제서비스본부', '우리 기관']);
  });
});

describe('조직 지도 파생', () => {
  it('부 지도: 부 문서가 두 팀 문서를 묶고, 부 업무(상위)와 팀 업무가 이어진다', () => {
    const d = deriveMap(s, { kind: 'org', orgId: org('전자금융부') }, NOW);
    expect(d.doc.universe.name).toBe('전자금융부');
    expect(d.doc.universe.level).toBe('부');
    expect(d.doc.refs.length).toBe(2);
    const v = buildView(d.doc, d.resolve);
    expect(v.missing).toEqual([]);
    // 팀 문서의 「이 지도 밖」 상위 업무는 부 문서의 진짜 업무와 합쳐져 하나만 보인다
    expect(v.nodes.filter((n: any) => n.label === '출금동의 제도 개편 총괄').length).toBe(1);
    const top = v.nodes.find((n: any) => n.label === '출금동의 제도 개편 총괄');
    const kids = v.edges.filter((e: any) => e.core_type === 'contains' && e.source === top.gid).map((e: any) => v.getNode(e.target).label);
    expect(kids).toEqual(expect.arrayContaining(['비대면 출금동의 추진', '약관·시행세칙 개정안 마련', '참가기관 전산 영향도 취합']));
  });

  it('회사 지도: 처음엔 본부만 접혀 보이고, 본부 사이 연결(보안점검팀 ↔ 디지털신원팀 업무)이 요약 선으로 보인다', () => {
    const d = deriveMap(s, { kind: 'all' }, NOW);
    const v = buildView(d.doc, d.resolve);
    const p = projectView(v, { expanded: new Set(), deepSummary: true });
    const roots = p.nodes.filter((n: any) => n.core_type === 'root').map((n: any) => n.label).sort();
    expect(roots).toEqual(['결제서비스본부', '경영지원본부', '우리 기관'].sort());
    expect(p.nodes.filter((n: any) => n.core_type === 'work').length).toBe(0); // 업무는 펼쳐야 보인다
    const ids = new Set(p.nodes.map((n: any) => n.gid));
    const byLabel = (l: string) => p.nodes.find((n: any) => n.label === l).gid;
    const cross = p.edges.filter((e: any) => [e.source, e.target].sort().join('|') === [byLabel('결제서비스본부'), byLabel('경영지원본부')].sort().join('|'));
    expect(cross.length).toBeGreaterThan(0);
    expect(p.edges.every((e: any) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    // 기본(deepSummary 끔)은 예전처럼 손자 이하 연결을 보이지 않는다
    const old = projectView(v, { expanded: new Set() });
    expect(old.edges.some((e: any) => [e.source, e.target].sort().join('|') === [byLabel('결제서비스본부'), byLabel('경영지원본부')].sort().join('|'))).toBe(false);
  });

  it('사람은 지도 전체에서 한 번씩', () => {
    const v = buildView(deriveMap(s, { kind: 'all' }, NOW).doc, deriveMap(s, { kind: 'all' }, NOW).resolve);
    const people = labelsOf(v, v.nodes.filter((n: any) => n.core_type === 'person' && !n.hidden)).sort();
    expect(people).toEqual(s.users.map((u) => u.name).sort());
  });

  it('조직 정보가 없는 옛 데이터: 담당 부서 글자를 상위 없는 팀으로 보고 그린다', () => {
    const old: AppState = { ...s, orgs: undefined };
    const d = deriveMap(old, { kind: 'all' }, NOW);
    expect(d.doc.universe.name).toBe('전체 조직');
    expect(d.doc.refs.length).toBe(new Set(old.works.map((w) => w.dept)).size);
    expect(buildView(d.doc, d.resolve).missing).toEqual([]);
  });
});

describe('조직 지도 인계 위험', () => {
  it('팀 지도의 위험은 그 팀 업무·사람 것만', () => {
    const scope = { kind: 'org' as const, orgId: org('보안점검팀') };
    const ids = new Set(worksInScope(s, scope).map((w) => w.id));
    const r = handoverInsights(s, scope, '2026-10-29');
    for (const x of r.items) {
      if (x.kind === 'dense' || x.kind === 'sole_person') expect(['U10'].includes(x.userIds[0]) || x.workIds.some((w) => ids.has(w))).toBe(true);
      else expect(ids.has(x.workIds[0])).toBe(true);
    }
  });
});
