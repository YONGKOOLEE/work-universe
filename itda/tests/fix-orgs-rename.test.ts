// A-L4(공백 dept 따라가기) · A-L5(이름 바꾸면 지도 숨김 키도 바꿈) · 지우기 검사도 trim 기준
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { editOrg, effectiveOrgs, removeOrg } from '../src/lib/orgs';
import type { AppState, Org } from '../src/lib/types';

const ORGS: Org[] = [
  { id: 'O-001', name: '우리 기관', level: '회사', parentId: null },
  { id: 'O-002', name: '가본부', level: '본부', parentId: 'O-001' },
  { id: 'O-003', name: '가부', level: '부', parentId: 'O-002' },
  { id: 'O-004', name: '가팀', level: '팀', parentId: 'O-003' },
  { id: 'O-005', name: '나팀', level: '팀', parentId: 'O-003' },
];
function base(): AppState {
  const s = createSeed('linked', new Date('2026-10-29T00:00:00Z'));
  s.orgs = JSON.parse(JSON.stringify(ORGS));
  s.users.forEach((u, i) => (u.dept = i % 2 ? '나팀' : '가팀'));
  s.works.forEach((w, i) => (w.dept = i % 2 ? '나팀' : '가팀'));
  return s;
}

describe('조직 이름 바꾸기(A-L4·L5)', () => {
  it('앞뒤 공백이 붙은 dept도 새 이름으로 따라간다', () => {
    const s = base();
    s.users[0].dept = '가팀 ';
    s.works[0].dept = ' 가팀';
    const r = editOrg(s, 'O-004', { name: '바뀐팀' });
    expect(r).toHaveProperty('summary');
    expect(s.users[0].dept).toBe('바뀐팀');
    expect(s.works[0].dept).toBe('바뀐팀');
    expect(effectiveOrgs(s).some((o) => o.id.startsWith('auto:') && o.name === '가팀')).toBe(false);
  });
  it('공백 dept가 남아 있으면 조직을 지울 수 없다', () => {
    const s = base();
    s.users.forEach((u) => (u.dept = '나팀'));
    s.works.forEach((w) => (w.dept = '나팀'));
    s.users[0].dept = '가팀 ';
    expect(removeOrg(s, 'O-004')).toHaveProperty('error');
  });
  it('mapHidden의 org:<이름> 키도 새 이름으로 바뀐다', () => {
    const s = base();
    s.mapHidden = ['org:가팀', 'org:나팀', 'work:W-001'];
    editOrg(s, 'O-004', { name: '바뀐팀' });
    expect(s.mapHidden.sort()).toEqual(['org:나팀', 'org:바뀐팀', 'work:W-001'].sort());
  });
  it('꼬리표 붙은 이름도 지도 키(꼬리표 뗀 이름)를 따라간다', () => {
    const s = base();
    s.orgs![3].name = '가팀 (시연용 가상 부서)';
    s.users.forEach((u) => u.dept === '가팀' && (u.dept = '가팀 (시연용 가상 부서)'));
    s.works.forEach((w) => w.dept === '가팀' && (w.dept = '가팀 (시연용 가상 부서)'));
    s.mapHidden = ['org:가팀'];
    editOrg(s, 'O-004', { name: '바뀐팀' });
    expect(s.mapHidden).toEqual(['org:바뀐팀']);
  });
  it('이름이 안 바뀌면 숨김 키는 그대로', () => {
    const s = base();
    s.mapHidden = ['org:가팀'];
    editOrg(s, 'O-004', { level: '팀', parentId: 'O-003' });
    expect(s.mapHidden).toEqual(['org:가팀']);
  });
});
