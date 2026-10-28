import { describe, it, expect } from 'vitest';
import { migrate } from '../src/lib/migrate';
import { createSeed, SCHEMA } from '../src/data/seed';
import { parseBackup } from '../src/lib/store';

const v6 = () => ({
  schema: 6,
  seedMode: 'fresh',
  seededAt: '2026-01-01T00:00:00.000Z',
  currentUserId: 'U1',
  users: [{ id: 'U1', name: '가상 사용자', dept: '가상 부서', title: '주무관' }],
  works: [{ id: 'W-001', name: '가상 업무', parentId: null, relatedIds: [], owners: ['U1'], partners: [] }],
  docs: [{ id: 'D-1', title: '가상 문서', meetingKey: 'M49' }],
  events: [],
  decisions: [],
  actions: [],
  history: [],
  handovers: [],
  snapshots: [{ id: 'S-1', work: { id: 'W-001' } }],
  meetingAnalysisApplied: true,
  searchLog: [],
  focus: {},
});

describe('migrate 6 -> 7', () => {
  it('업무에 nextIds·topics, 상태에 mapHidden 빈 배열을 채우고 meetingAnalysisApplied를 지운다', () => {
    const s = migrate(v6()) as any;
    expect(s.schema).toBe(7);
    expect(s.works[0].nextIds).toEqual([]);
    expect(s.works[0].topics).toEqual([]);
    expect(s.snapshots[0].work.nextIds).toEqual([]);
    expect(s.mapHidden).toEqual([]);
    expect('meetingAnalysisApplied' in s).toBe(false);
    expect('meetingKey' in s.docs[0]).toBe(false);
  });
  it('이미 있는 nextIds·topics는 보존한다', () => {
    const x: any = v6();
    x.works[0].nextIds = ['W-002'];
    expect((migrate(x) as any).works[0].nextIds).toEqual(['W-002']);
  });
  it('schema 7은 그대로 통과, 5 이하는 거부한다', () => {
    const s7 = migrate(v6());
    expect(migrate(s7)).toBe(s7);
    expect(() => migrate({ ...v6(), schema: 5 })).toThrow(/지원하지 않는 데이터 버전/);
  });
});

describe('parseBackup', () => {
  it('schema 6과 7을 받는다', () => {
    expect(parseBackup(JSON.stringify(v6())).schema).toBe(7);
    const s7 = JSON.stringify(migrate(v6()));
    expect(parseBackup(s7).schema).toBe(7);
  });
  it('schema 5와 형식 오류를 거부한다', () => {
    expect(() => parseBackup(JSON.stringify({ ...v6(), schema: 5 }))).toThrow(/지원하지 않는 데이터 버전/);
    expect(() => parseBackup('not json')).toThrow(/JSON 형식/);
    expect(() => parseBackup(JSON.stringify({ schema: 7 }))).toThrow(/데이터 형식/);
  });
});

describe('createSeed', () => {
  const REAL = /국무회의|행정안전부|모바일 신분증|금융결제원|주민등록|mois\.go\.kr|의안/;
  it("linked: 시연 상태(업무 15·문서 7·이벤트 14·결정 6·조치 16·이력 17·인계 1·스냅샷 1)이고 실제 기관명이 없다", () => {
    const s = createSeed('linked');
    expect(s.schema).toBe(SCHEMA);
    expect([s.works.length, s.docs.length, s.events.length, s.decisions.length, s.actions.length, s.history.length]).toEqual([15, 7, 14, 6, 16, 17]); // 업무 8→10: 인계 위험 인사이트 시연용 W-009·W-010, 10→15: 조직 계층(부·본부) 시연용 W-011~W-015(2026-10-29 사용자 결정)
    expect([s.handovers.length, s.snapshots.length]).toEqual([1, 1]);
    expect(s.works.every((w) => Array.isArray(w.nextIds) && Array.isArray(w.topics))).toBe(true);
    expect(s.mapHidden).toEqual([]);
    expect(s.users.map((u) => u.empNo)).toEqual(['V-1001', 'V-1002', 'V-1003', 'V-1004', 'V-1005', 'V-1006', 'V-1007', 'V-1008', 'V-1009', 'V-1010']); // V-1008~1010: 조직 계층 시연용(2026-10-29)
    const text = JSON.stringify(s);
    expect(text).not.toMatch(REAL);
    expect(text).toContain('한빛결제원(가상)');
  });
  it('fresh: 사용자만 있고 데이터는 비어 있다', () => {
    const s = createSeed('fresh');
    expect(s.users.length).toBe(2);
    expect([s.works, s.docs, s.events, s.decisions, s.actions, s.history, s.handovers].every((a) => a.length === 0)).toBe(true);
    expect(s.schema).toBe(7);
  });
});
