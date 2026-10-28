import { describe, expect, it } from 'vitest';
import { addMemo, addTopic, assignOwner, linkWorks, removeTopic, setMapHidden, unlinkWorks } from '../src/universe/commands';
import { createSeed } from '../src/data/seed';
import type { AppState } from '../src/lib/types';

function base(): AppState {
  const s = createSeed('linked');
  const w = s.works[0];
  s.works.push({ ...JSON.parse(JSON.stringify(w)), id: 'W-002', name: '약관 개정안 마련', parentId: null, relatedIds: [], nextIds: [], topics: [] });
  s.works.push({ ...JSON.parse(JSON.stringify(w)), id: 'W-003', name: '하위 점검', parentId: 'W-002', relatedIds: [], nextIds: [], topics: [] });
  return s;
}
const TODAY = '2026-10-29';

describe('지도 편집 명령(D24-5)', () => {
  it('담당 넘기기: 기존 기간 종료·새 기간 시작·미완료 조치 이관', () => {
    const s = base();
    const w = s.works[0];
    expect(w.owners).toEqual(['U1']);
    const c = assignOwner(s, w.id, 'U2', 'hand', TODAY);
    expect(c?.summary).toContain('김도윤 → 이서연');
    expect(w.owners).toEqual(['U2']);
    expect(w.ownerHistory.find((p) => p.userId === 'U1')?.to).toBe(TODAY);
    expect(w.ownerHistory.find((p) => p.userId === 'U2')).toMatchObject({ from: TODAY, to: null });
    expect(s.actions.filter((a) => a.workId === w.id && a.status !== '완료').every((a) => a.ownerId === 'U2')).toBe(true);
    expect(assignOwner(s, w.id, 'U2', 'hand', TODAY)).toBeNull();
  });
  it('담당 추가: 공동 담당, 기존 기간 유지', () => {
    const s = base();
    const w = s.works[0];
    assignOwner(s, w.id, 'U2', 'add', TODAY);
    expect(w.owners).toEqual(['U1', 'U2']);
    expect(w.ownerHistory.filter((p) => !p.to).map((p) => p.userId).sort()).toEqual(['U1', 'U2']);
    expect(assignOwner(s, w.id, 'U2', 'add', TODAY)).toBeNull();
    expect(assignOwner(s, w.id, 'U-없음', 'add', TODAY)).toBeNull();
  });
  it('업무 잇기·끊기: 상위(순환 막기)·관련(양쪽)·다음', () => {
    const s = base();
    expect(linkWorks(s, 'W-002', 'W-003', 'parent')).toBeNull(); // W-003은 W-002의 하위
    expect(linkWorks(s, 'W-001', 'W-002', 'parent')?.summary).toContain('상위 업무');
    expect(s.works[0].parentId).toBe('W-002');
    linkWorks(s, 'W-001', 'W-003', 'related');
    expect(s.works.find((w) => w.id === 'W-003')?.relatedIds).toContain('W-001');
    linkWorks(s, 'W-003', 'W-001', 'next');
    expect(linkWorks(s, 'W-001', 'W-003', 'next')).toBeNull(); // 반대 방향 선후행은 막음
    expect(unlinkWorks(s, 'W-001', 'W-003', 'related')).not.toBeNull();
    expect(s.works.find((w) => w.id === 'W-003')?.relatedIds).not.toContain('W-001');
    expect(unlinkWorks(s, 'W-001', 'W-002', 'parent')).not.toBeNull();
    expect(s.works[0].parentId).toBeNull();
  });
  it('메모·주제·숨김', () => {
    const s = base();
    const w = s.works[0];
    const n = w.cautions.length;
    expect(addMemo(s, w.id, '  ', 'caution')).toBeNull();
    addMemo(s, w.id, '첫 영업일 새벽은 점검 시간', 'caution');
    expect(w.cautions.length).toBe(n + 1);
    expect(w.cautions.at(-1)).toMatchObject({ prov: 'owner', text: '첫 영업일 새벽은 점검 시간' });
    addTopic(s, w.id, '본인 확인');
    expect(addTopic(s, w.id, '본인확인')).toBeNull(); // 띄어쓰기만 다른 같은 주제
    expect(removeTopic(s, w.id, '본인 확인')).not.toBeNull();
    expect(setMapHidden(s, 'doc:D-1', true)).toBe(true);
    expect(setMapHidden(s, 'doc:D-1', true)).toBe(false);
    expect(s.mapHidden).toEqual(['doc:D-1']);
    setMapHidden(s, 'doc:D-1', false);
    expect(s.mapHidden).toEqual([]);
  });
});
