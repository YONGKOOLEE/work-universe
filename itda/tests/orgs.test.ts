import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { addOrg, editOrg, effectiveOrgs, orgPathText, orgTree, removeOrg, worksOfOrg } from '../src/lib/orgs';
import { applyMerge, planMerge } from '../src/lib/mergeImport';
import { clone } from '../src/lib/util';
import type { AppState, Org } from '../src/lib/types';

const ORGS: Org[] = [
  { id: 'O-001', name: '우리 기관', level: '회사', parentId: null },
  { id: 'O-002', name: '가본부', level: '본부', parentId: 'O-001' },
  { id: 'O-003', name: '가부', level: '부', parentId: 'O-002' },
  { id: 'O-004', name: '가팀', level: '팀', parentId: 'O-003' },
  { id: 'O-005', name: '나팀', level: '팀', parentId: 'O-003' },
];

/** 시드를 가져와 조직·사람·업무의 dept를 가상 조직으로 맞춘다 */
function base(withOrgs = true): AppState {
  const s = createSeed('linked', new Date('2026-10-29T00:00:00Z'));
  s.users.forEach((u, i) => (u.dept = i % 2 ? '나팀' : '가팀'));
  s.works.forEach((w, i) => (w.dept = i % 2 ? '나팀' : '가팀'));
  s.orgs = withOrgs ? clone(ORGS) : undefined;
  return s;
}
const isErr = (r: unknown): r is { error: string } => !!r && typeof r === 'object' && 'error' in r;

describe('effectiveOrgs', () => {
  it('저장된 조직이 없으면 dept 글자마다 상위 없는 팀을 만든다', () => {
    const s = base(false);
    const e = effectiveOrgs(s);
    expect(e.map((o) => o.name).sort()).toEqual(['가팀', '나팀']);
    expect(e.every((o) => o.level === '팀' && o.parentId === null && o.id.startsWith('auto:'))).toBe(true);
  });
  it('목록에 없는 dept만 자동 팀으로 더한다', () => {
    const s = base();
    s.users[0].dept = '떠돌이팀';
    const e = effectiveOrgs(s);
    expect(e).toHaveLength(ORGS.length + 1);
    expect(e.find((o) => o.name === '떠돌이팀')?.id).toBe('auto:떠돌이팀');
  });
});

describe('addOrg', () => {
  it('정상 추가: 새 O-### 번호', () => {
    const s = base();
    const r = addOrg(s, { name: '다팀', level: '팀', parentId: 'O-003' });
    expect(isErr(r)).toBe(false);
    expect(s.orgs!.at(-1)).toMatchObject({ id: 'O-006', name: '다팀', parentId: 'O-003' });
  });
  it('이름 중복·너무 짧음 거부', () => {
    const s = base();
    expect(isErr(addOrg(s, { name: '가팀', level: '팀', parentId: null }))).toBe(true);
    expect(isErr(addOrg(s, { name: '다', level: '팀', parentId: null }))).toBe(true);
  });
  it('상위는 더 큰 단계여야 하고 없는 상위는 거부', () => {
    const s = base();
    expect(isErr(addOrg(s, { name: '라부', level: '부', parentId: 'O-004' }))).toBe(true);
    expect(isErr(addOrg(s, { name: '라부', level: '부', parentId: 'O-003' }))).toBe(true);
    expect(isErr(addOrg(s, { name: '라부', level: '부', parentId: 'O-999' }))).toBe(true);
    expect(isErr(addOrg(s, { name: '라부', level: '부', parentId: 'O-002' }))).toBe(false);
  });
  it('첫 명령에서 자동 팀을 저장된 조직(O-###)으로 만든다', () => {
    const s = base(false);
    const r = addOrg(s, { name: '새본부', level: '본부', parentId: null });
    expect(isErr(r)).toBe(false);
    expect(s.orgs!.map((o) => o.id)).toEqual(['O-001', 'O-002', 'O-003']);
    expect(s.orgs!.slice(0, 2).map((o) => o.name).sort()).toEqual(['가팀', '나팀']);
  });
});

describe('editOrg', () => {
  it('이름을 바꾸면 사람·업무 dept가 따라 바뀐다', () => {
    const s = base();
    const nWorks = s.works.filter((w) => w.dept === '가팀').length;
    const nUsers = s.users.filter((u) => u.dept === '가팀').length;
    expect(nWorks + nUsers).toBeGreaterThan(0);
    const r = editOrg(s, 'O-004', { name: '가팀 새이름' });
    expect(isErr(r)).toBe(false);
    expect(s.works.filter((w) => w.dept === '가팀 새이름')).toHaveLength(nWorks);
    expect(s.users.filter((u) => u.dept === '가팀 새이름')).toHaveLength(nUsers);
    expect(s.works.some((w) => w.dept === '가팀')).toBe(false);
  });
  it('조직개편: 상위를 바꾸면 경로가 바뀐다', () => {
    const s = base();
    addOrg(s, { name: '다부', level: '부', parentId: 'O-002' });
    const r = editOrg(s, 'O-004', { parentId: 'O-006' });
    expect(isErr(r)).toBe(false);
    expect(orgPathText(effectiveOrgs(s), '가팀')).toBe('우리 기관 › 가본부 › 다부 › 가팀');
  });
  it('순환 금지: 자기 아래 조직을 상위로 못 둔다', () => {
    const s = base();
    expect(isErr(editOrg(s, 'O-002', { parentId: 'O-004' }))).toBe(true);
    expect(isErr(editOrg(s, 'O-002', { parentId: 'O-002' }))).toBe(true);
  });
  it('아래 조직보다 작은 단계로 못 바꾼다', () => {
    const s = base();
    expect(isErr(editOrg(s, 'O-003', { level: '팀' }))).toBe(true);
  });
  it('이름 중복 거부, 바뀐 것 없으면 null', () => {
    const s = base();
    expect(isErr(editOrg(s, 'O-004', { name: '나팀' }))).toBe(true);
    expect(editOrg(s, 'O-004', { name: '가팀' })).toBeNull();
    expect(isErr(editOrg(s, 'O-999', { name: '없음조직' }))).toBe(true);
  });
});

describe('removeOrg', () => {
  it('아래 조직이 있으면 거부', () => {
    const s = base();
    const r = removeOrg(s, 'O-003');
    expect(isErr(r) && r.error).toContain('아래 조직');
    expect(s.orgs).toHaveLength(ORGS.length);
  });
  it('업무·사람이 쓰는 조직은 거부', () => {
    const s = base();
    const r = removeOrg(s, 'O-004');
    expect(isErr(r) && r.error).toContain('업무·사람');
  });
  it('비어 있으면 지운다', () => {
    const s = base();
    addOrg(s, { name: '빈팀', level: '팀', parentId: 'O-003' });
    const id = s.orgs!.find((o) => o.name === '빈팀')!.id;
    expect(isErr(removeOrg(s, id))).toBe(false);
    expect(s.orgs!.some((o) => o.id === id)).toBe(false);
  });
});

describe('경로·트리·업무', () => {
  it('orgPathText: 위 → 아래, 모르는 이름은 그대로', () => {
    const e = effectiveOrgs(base());
    expect(orgPathText(e, '가팀')).toBe('우리 기관 › 가본부 › 가부 › 가팀');
    expect(orgPathText(e, '낯선 팀 (시연용 가상 부서)')).toBe('낯선 팀');
    expect(orgPathText(e, '')).toBe('소속 미정');
  });
  it('orgTree: 위에서 아래, 깊이 포함', () => {
    const t = orgTree(ORGS);
    expect(t.map((x) => `${x.depth}:${x.org.id}`)).toEqual(['0:O-001', '1:O-002', '2:O-003', '3:O-004', '3:O-005']);
  });
  it('worksOfOrg: 아래 조직 업무까지 모은다', () => {
    const s = base();
    expect(worksOfOrg(s, 'O-001')).toHaveLength(s.works.length);
    expect(worksOfOrg(s, 'O-003')).toHaveLength(s.works.length);
    expect(worksOfOrg(s, 'O-004')).toHaveLength(s.works.filter((w) => w.dept === '가팀').length);
  });
});

describe('합쳐 불러오기: 조직 합집합', () => {
  it('이름이 없는 조직만 새 번호로 더하고 상위를 이름으로 다시 잇는다', () => {
    const cur = base();
    const inc = clone(cur);
    inc.orgs = [
      ...clone(ORGS),
      { id: 'O-006', name: '새부', level: '부', parentId: 'O-002' },
      { id: 'O-007', name: '새팀', level: '팀', parentId: 'O-006' },
    ];
    // 들어온 쪽 번호가 달라도 이름으로 맞춘다
    inc.orgs[1].id = 'O-102';
    inc.orgs.find((o) => o.id === 'O-003')!.parentId = 'O-102';
    inc.orgs.find((o) => o.id === 'O-006')!.parentId = 'O-102';
    const plan = planMerge(cur, inc);
    expect(plan.counts.orgs).toBe(2);
    const { state } = applyMerge(cur, inc);
    expect(state.orgs).toHaveLength(ORGS.length + 2);
    const nb = state.orgs!.find((o) => o.name === '새부')!;
    const nt = state.orgs!.find((o) => o.name === '새팀')!;
    expect(nb.id).toBe('O-006');
    expect(nt.id).toBe('O-007');
    expect(nb.parentId).toBe('O-002'); // 지금의 가본부 id
    expect(nt.parentId).toBe('O-006');
    // 기존 조직은 그대로
    expect(state.orgs!.slice(0, ORGS.length)).toEqual(ORGS);
  });
  it('같은 조직뿐이면 0개 추가', () => {
    const cur = base();
    const inc = clone(cur);
    expect(planMerge(cur, inc).counts.orgs).toBe(0);
    expect(applyMerge(cur, inc).state.orgs).toEqual(ORGS);
  });
  it('지금 orgs가 없어도 동작한다', () => {
    const cur = base(false);
    const inc = base();
    const { state } = applyMerge(cur, inc);
    expect(state.orgs).toHaveLength(ORGS.length);
    expect(state.orgs![0].id).toBe('O-001');
  });
});
