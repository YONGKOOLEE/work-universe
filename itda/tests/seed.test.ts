import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { deriveMap } from '../src/universe/derive';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { soloWorks } from '../../app/src/view/space-marks.js';

const REAL = /국무회의|행정안전부|모바일 신분증|금융결제원|주민등록|mois\.go\.kr|의안/;
const s = createSeed('linked', new Date('2026-10-29T09:00:00Z'));
const userIds = new Set(s.users.map((u) => u.id));
const workIds = new Set(s.works.map((w) => w.id));
const docById = new Map(s.docs.map((d) => [d.id, d]));
const citeOk = (c: { docId: string; anchor?: string }) => {
  const d = docById.get(c.docId);
  return !!d && (!c.anchor || !!d.paragraphs?.some((p) => p.id === c.anchor));
};

describe('시연 데이터(linked) 참조 무결성', () => {
  it('사용자: 사번 V-숫자4자리, 팀장 1명, 소속 조직 5곳(팀 4·부 1)', () => {
    expect(s.users.length).toBe(10); // 7→10: 조직 계층 시연용 부장·다른 부·본부 팀원(2026-10-29 사용자 결정)
    expect(s.users.every((u) => /^V-\d{4}$/.test(u.empNo ?? ''))).toBe(true);
    expect(s.users.filter((u) => u.role === 'lead').length).toBe(1);
    expect(new Set(s.users.map((u) => u.dept)).size).toBe(5);
    expect(s.users.every((u) => (s.orgs || []).some((o) => o.name === u.dept))).toBe(true);
    expect(s.currentUserId).toBe('U1');
    expect(s.mapHidden).toEqual([]);
    expect(s.focus).toEqual({});
  });
  it('업무 참조: owners·ownerHistory·parentId·relatedIds·nextIds·doc.workIds', () => {
    expect(s.works.length).toBe(15); // 인계 위험 인사이트 시연용 W-009·W-010, 조직 계층 시연용 W-011~W-015(2026-10-29)
    expect(s.works.every((w) => (s.orgs || []).some((o) => o.name === w.dept))).toBe(true);
    for (const w of s.works) {
      expect(w.owners.every((o) => userIds.has(o)), w.id).toBe(true);
      expect(w.ownerHistory.every((p) => userIds.has(p.userId)), w.id).toBe(true);
      expect(w.owners.every((o) => w.ownerHistory.some((p) => p.userId === o && !p.to)), w.id).toBe(true);
      if (w.parentId) expect(workIds.has(w.parentId), w.id).toBe(true);
      expect([...w.relatedIds, ...w.nextIds].every((x) => workIds.has(x)), w.id).toBe(true);
    }
    expect(s.docs.every((d) => d.workIds.every((x) => workIds.has(x)))).toBe(true);
    expect(s.works.find((w) => w.id === 'W-001')!.relatedIds).toContain('W-005');
    expect(s.works.find((w) => w.id === 'W-005')!.relatedIds).toContain('W-001');
    expect(s.works.find((w) => w.id === 'W-001')!.nextIds).toContain('W-003');
  });
  it('ID 중복 없음, 접두어-3자리 규칙(기존 W-001 계열)', () => {
    for (const list of [s.works, s.docs, s.events, s.decisions, s.actions, s.history, s.handovers, s.snapshots]) {
      const ids = list.map((x) => x.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(s.works.every((w) => /^W-\d{3}$/.test(w.id))).toBe(true);
  });
  it('cite(docId+anchor)가 실제 문서 문단을 가리킨다', () => {
    const cites = [
      ...s.works.flatMap((w) => [...w.purpose, ...w.background, ...w.current, ...w.cautions, ...w.rejected].flatMap((x) => x.cite ?? [])),
      ...s.works.flatMap((w) => w.partners.flatMap((p) => p.cite ?? [])),
      ...s.decisions.flatMap((d) => d.cite), ...s.actions.flatMap((a) => a.cite ?? []), ...s.events.flatMap((e) => e.cite),
    ];
    expect(cites.length).toBeGreaterThan(30);
    const bad = cites.filter((c) => !citeOk(c));
    expect(bad).toEqual([]);
    for (const d of s.docs) expect(d.paragraphs?.every((p) => /^p\d*-?\d+$/.test(p.id))).toBe(true);
    expect(s.events.every((e) => e.docIds.every((x) => docById.has(x)) && e.workIds.every((x) => workIds.has(x)))).toBe(true);
  });
  it('조치·결정·이력', () => {
    expect(s.actions.every((a) => workIds.has(a.workId) && userIds.has(a.ownerId))).toBe(true);
    expect(s.decisions.every((d) => workIds.has(d.workId))).toBe(true);
    expect(s.history.every((h) => workIds.has(h.workId) && (h.actorId === 'ai' || userIds.has(h.actorId)))).toBe(true);
    const open = s.actions.filter((a) => a.status !== '완료');
    expect(open.some((a) => a.due && a.due < '2026-10-29')).toBe(true);
    expect(open.some((a) => !a.due)).toBe(true);
  });
  it('인계 HO-001: 대상·스냅샷·담당 기간·이벤트·이력이 확정 규칙과 맞다', () => {
    const h = s.handovers[0];
    expect(h.status).toBe('confirmed');
    expect(userIds.has(h.fromId) && userIds.has(h.toId) && workIds.has(h.workId)).toBe(true);
    const sn = s.snapshots.find((x) => x.id === h.snapshotId)!;
    expect(sn.handoverId).toBe(h.id);
    expect(sn.workId).toBe(h.workId);
    const w = s.works.find((x) => x.id === h.workId)!;
    expect(sn.version).toBe(w.version - 1);
    expect(w.owners).toEqual([h.toId]);
    const from = w.ownerHistory.find((p) => p.userId === h.fromId)!;
    const to = w.ownerHistory.find((p) => p.userId === h.toId)!;
    expect(from.to).toBeTruthy();
    expect(to.to).toBeNull();
    expect(to.note).toContain(h.id);
    expect(s.events.some((e) => e.type === '담당자 변경' && e.workIds.includes(w.id) && e.source === 'record' && e.phase === '플랫폼 기록')).toBe(true);
    expect(s.history.some((x) => x.workId === w.id && x.kind === '인계 확정' && x.summary.includes(h.id))).toBe(true);
  });
  it('주제 2~4개가 여러 업무에 겹치고, 가상 기관만 쓰며 실제 기관명이 없다', () => {
    const count = new Map<string, number>();
    for (const w of s.works) for (const t of w.topics) count.set(t, (count.get(t) ?? 0) + 1);
    expect(count.size).toBeGreaterThanOrEqual(2);
    expect(count.size).toBeLessThanOrEqual(4);
    expect([...count.values()].every((n) => n >= 2)).toBe(true);
    const text = JSON.stringify(s);
    expect(text).not.toMatch(REAL);
    expect(text).toContain('한빛결제원(가상)');
  });
});

describe('시연 데이터(linked) → 업무 유니버스 지도', () => {
  it('전체 지도: 회사 → 본부 2개, 사람 10명 한 번씩·혼자만 아는 일 1건 이상', () => {
    const d = deriveMap(s, { kind: 'all', title: '가상 부서' }, '2026-10-29T09:00:00.000Z');
    expect(d.doc.universe.name).toBe('우리 기관');
    expect(d.doc.refs.length).toBe(2); // 결제서비스본부·경영지원본부
    const v = buildView(d.doc, d.resolve);
    expect(v.missing).toEqual([]);
    const people = v.nodes.filter((n: any) => n.core_type === 'person' && !n.hidden).map((n: any) => n.label).sort();
    expect(people).toEqual(s.users.map((u) => u.name).sort());
    const solo = soloWorks(v, '2026-10-29');
    expect(solo.size).toBeGreaterThanOrEqual(1);
    const soloLabels = [...solo].map((g: string) => v.getNode(g).label);
    expect(soloLabels).toContain('출금이체 월 정산');
  });
});
