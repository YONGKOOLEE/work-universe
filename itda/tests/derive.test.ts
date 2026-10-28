import { describe, expect, it } from 'vitest';
import { deriveMap, hideKey } from '../src/universe/derive';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { buildView } from '../../app/src/view/view.js';
// @ts-expect-error 유니버스 순수 모듈(JS)
import { projectView } from '../../app/src/view/collapse.js';
import type { AppState, Work } from '../src/lib/types';

const NOW = '2026-10-29T09:00:00.000Z';
const work = (p: Partial<Work> & { id: string; name: string }): Work => ({
  parentId: null, relatedIds: [], nextIds: [], topics: [], type: '운영·관리', agency: '', dept: '가상정산팀', owners: [], ownerHistory: [],
  status: '진행 중', createdAt: '2026-09-01', updatedAt: '2026-10-01T00:00:00Z', version: 1, summary: '', keywords: [],
  purpose: [], background: [], current: [], cautions: [], rejected: [], partners: [], ...p,
}) as Work;

function state(): AppState {
  return {
    schema: 7, seedMode: 'linked', seededAt: NOW, currentUserId: 'U1',
    users: [
      { id: 'U1', name: '가나다', dept: '가상정산팀 (시연용 가상 부서)', title: '주무관', empNo: 'V-1001', role: 'member' },
      { id: 'U2', name: '라마바', dept: '가상정산팀', title: '주무관', empNo: 'V-1002', role: 'member' },
      { id: 'U3', name: '사아자', dept: '가상결제팀', title: '팀장', empNo: 'V-1003', role: 'lead' },
    ],
    works: [
      work({ id: 'W-001', name: '월말 정산 점검', owners: ['U2'], ownerHistory: [{ userId: 'U1', from: '2026-03-01', to: '2026-09-30' }, { userId: 'U2', from: '2026-10-01', to: null }], nextIds: ['W-003'], topics: ['대사'], cautions: [{ id: 's1', text: '첫 영업일 새벽 점검 시간 피하기', prov: 'owner' }] }),
      work({ id: 'W-002', name: '정산 자료 수집', parentId: 'W-001', owners: ['U2'], ownerHistory: [{ userId: 'U2', from: '2026-10-01', to: null }] }),
      work({ id: 'W-003', name: '결제 승인 대사', dept: '가상결제팀', owners: ['U3', 'U2'], ownerHistory: [{ userId: 'U3', from: '2026-01-01', to: null }], relatedIds: ['W-001'], topics: ['대사'], partners: [{ name: '한빛결제원(가상)', role: '자료 제공', prov: 'owner' }] }),
    ],
    docs: [{ id: 'D-1', title: '정산 점검 회의록', type: '회의록', writtenAt: '2026-10-20', registeredAt: NOW, source: '', availability: 'original', workIds: ['W-001'], summary: [], keywords: [], relations: [], analyzed: true, registeredBy: 'U2' }],
    events: [], decisions: [],
    actions: [
      { id: 'A-1', workId: 'W-001', title: '불일치 3건 재조회', due: '2026-11-05', status: '예정', ownerId: 'U2', createdAt: NOW },
      { id: 'A-2', workId: 'W-001', title: '끝난 조치', due: null, status: '완료', ownerId: 'U2', createdAt: NOW },
    ],
    history: [],
    handovers: [{ id: 'HO-001', workId: 'W-001', fromId: 'U1', toId: 'U2', baseDate: '2026-09-30', status: 'confirmed', step: 8, precheckDone: true, checklist: {}, supplement: '', fromLeaves: true, requests: [], log: [], confirmedAt: '2026-09-30T10:00:00Z', createdAt: NOW }],
    snapshots: [], searchLog: [], focus: {}, mapHidden: [],
  } as unknown as AppState;
}

const labelsOf = (view: any, type: string) => view.nodes.filter((n: any) => n.core_type === type && !n.hidden).map((n: any) => n.label).sort();

describe('deriveMap ① 업무 지도', () => {
  it('업무가 지도 중심, 하위 업무·담당·문서·할 일·주제·메모·인계가 들어간다', () => {
    const d = deriveMap(state(), { kind: 'work', workId: 'W-001' }, NOW);
    const v = buildView(d.doc, d.resolve);
    expect(v.getNode(`${d.doc.universe.id}/N-000`).label).toBe('월말 정산 점검');
    expect(labelsOf(v, 'person')).toEqual(['가나다', '라마바']);
    expect(labelsOf(v, 'work')).toEqual(['결제 승인 대사', '불일치 3건 재조회', '정산 자료 수집']); // 하위 업무·할 일·다음 업무(범위 밖)
    expect(labelsOf(v, 'artifact')).toEqual(['정산 점검 회의록']);
    expect(labelsOf(v, 'topic')).toEqual(['대사']);
    expect(labelsOf(v, 'org')).toEqual(['가상정산팀']); // 「(시연용 가상 부서)」 꼬리표는 같은 조직
    const types = v.events.map((e: any) => e.type).sort();
    expect(types).toEqual(['assign_end', 'assign_start', 'assign_start', 'assign_start', 'handover', 'memo']);
    expect(v.events.find((e: any) => e.type === 'memo').note).toBe('첫 영업일 새벽 점검 시간 피하기');
    // 완료한 조치는 지도에 없다
    expect(v.nodes.some((n: any) => n.label === '끝난 조치')).toBe(false);
  });
  it('담당 기간이 수행 연결의 기간이 된다', () => {
    const d = deriveMap(state(), { kind: 'work', workId: 'W-001' }, NOW);
    const v = buildView(d.doc, d.resolve);
    const perf = v.edges.filter((e: any) => e.core_type === 'performs' && e.target === `${d.doc.universe.id}/N-000`);
    expect(perf.map((e: any) => e.period)).toEqual([{ start: '2026-03-01', end: '2026-09-30' }, { start: '2026-10-01' }]);
  });
  it('origin으로 원래 항목을 찾는다', () => {
    const d = deriveMap(state(), { kind: 'work', workId: 'W-001' }, NOW);
    const uid = d.doc.universe.id;
    expect(d.origin.get(`${uid}/N-000`)).toEqual({ kind: 'work', id: 'W-001' });
    expect(d.origin.get(`${uid}/N-user-U2`)).toEqual({ kind: 'user', id: 'U2' });
    expect(d.origin.get(`${uid}/N-action-A-1`)).toEqual({ kind: 'action', id: 'A-1' });
  });
  it('숨김 키가 있으면 숨긴다', () => {
    const s = state();
    s.mapHidden = [hideKey({ kind: 'doc', id: 'D-1' })];
    const d = deriveMap(s, { kind: 'work', workId: 'W-001' }, NOW);
    expect(labelsOf(buildView(d.doc, d.resolve), 'artifact')).toEqual([]);
  });
});

describe('deriveMap ② 내 지도', () => {
  it('내가 담당하는 업무와 그 하위가 지도 중심에 이어진다', () => {
    const d = deriveMap(state(), { kind: 'mine', userId: 'U3' }, NOW);
    const v = buildView(d.doc, d.resolve);
    expect(v.getNode(`${d.doc.universe.id}/N-000`).label).toBe('사아자의 업무');
    expect(labelsOf(v, 'work')).toContain('결제 승인 대사');
    expect(labelsOf(v, 'work')).toContain('월말 정산 점검'); // 관련 업무(범위 밖)
    const root = `${d.doc.universe.id}/N-000`;
    expect(v.edges.some((e: any) => e.core_type === 'contains' && e.source === root && v.getNode(e.target).label === '결제 승인 대사')).toBe(true);
    expect(v.edges.some((e: any) => e.source === 'N-000' || e.source === 'ROOT')).toBe(false);
  });
});

describe('deriveMap ③ 전체(팀으로 접기)', () => {
  it('팀마다 하위 유니버스, 같은 사람·업무·주제는 하나로 합친다', () => {
    const d = deriveMap(state(), { kind: 'all', title: '가상 부서' }, NOW);
    expect(d.doc.refs.length).toBe(2);
    const v = buildView(d.doc, d.resolve);
    expect(v.missing).toEqual([]);
    // 라마바(U2)는 두 팀 문서에 다 있지만 지도에는 한 명
    expect(labelsOf(v, 'person').filter((l: string) => l === '라마바').length).toBe(1);
    expect(labelsOf(v, 'topic')).toEqual(['대사']);
    expect(labelsOf(v, 'work').filter((l: string) => l === '결제 승인 대사').length).toBe(1);
    // 접은 상태: 팀 지도 중심 두 개가 보인다
    const shown = projectView(v, { expanded: new Set() });
    const roots = shown.nodes.filter((n: any) => n.core_type === 'root').map((n: any) => n.label).sort();
    expect(roots).toEqual(['가상 부서', '가상결제팀', '가상정산팀']);
  });
});

import { shortTitle } from '../src/universe/derive';
describe('할 일 이름 줄이기', () => {
  it('날짜·「까지」·끝 「예정임」을 떼고 22자에서 자른다', () => {
    expect(shortTitle('2026. 12. 31.까지 약관 및 시행세칙 개정안을 마련할 계획임.')).toBe('약관 및 시행세칙 개정안을 마련');
    expect(shortTitle('참가기관은 2026. 11. 30.까지 전산 영향도 검토 결과를 제출할 예정임.')).toBe('참가기관은 전산 영향도 검토 결과를 제출');
    expect(shortTitle('불일치 3건 재조회')).toBe('불일치 3건 재조회');
  });
});
