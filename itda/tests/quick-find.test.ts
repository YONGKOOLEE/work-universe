// 상단 「바로 찾기」(사용자 결정 2026-10-29): 메뉴·기능·업무·문서·사람 이름 찾기
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { scopeFor } from '../src/lib/store';
import { addPrivateMemo } from '../src/universe/commands';
import { choseong, flatten, looksLikeQuestion, quickFind } from '../src/lib/quickFind';

const seed = () => createSeed('linked');
const titles = (s: ReturnType<typeof seed>, q: string) => flatten(quickFind(s, q)).map((i) => i.title);

describe('바로 찾기', () => {
  it('빈 검색어는 메뉴·기능만', () => {
    const g = quickFind(seed(), '');
    expect(g.map((x) => x.kind)).toEqual(['menu', 'action']);
    expect(g[0].items.map((i) => i.title)).toContain('문서함');
    expect(g[1].items.map((i) => i.title)).toContain('데이터 옮기기');
  });
  it('메뉴·기능 이름과 별칭', () => {
    const s = seed();
    expect(titles(s, '문서함')[0]).toBe('문서함');
    expect(titles(s, ' 업무  유니버스 ')).toContain('업무 유니버스');
    for (const a of ['백업', '내보내기', '가져오기', '옮기기']) expect(titles(s, a)).toContain('데이터 옮기기');
    for (const a of ['합치기', '동료 데이터', '팀 지도']) expect(titles(s, a)).toContain('합쳐 불러오기');
    expect(titles(s, 'API 키')).toContain('AI 설정');
    expect(titles(s, '다크')).toContain('밝기 바꾸기');
    const merge = flatten(quickFind(s, '합쳐')).find((i) => i.title === '합쳐 불러오기')!;
    expect(merge.action).toBe('merge');
    expect(flatten(quickFind(s, '문서 등록'))[0].to).toBe('/docs?new=1');
  });
  it('되돌릴 수 없는 동작은 없다', () => {
    expect(titles(seed(), '초기화')).not.toContain('처음 상태로 되돌리기');
    expect(titles(seed(), '지우기').filter((t) => /지우|초기/.test(t))).toEqual([]);
  });
  it('초성', () => {
    const s = seed();
    expect(choseong('데이터 옮기기')).toBe('ㄷㅇㅌㅇㄱㄱ');
    expect(titles(s, 'ㄷㅇㅌ')).toContain('데이터 옮기기');
    expect(titles(s, 'ㅇㅁ').length).toBeGreaterThan(0);
  });
  it('업무·문서는 ID로도', () => {
    const s = seed();
    const w = s.works[0];
    const d = s.docs[0];
    expect(quickFind(s, w.id.toLowerCase()).find((g) => g.kind === 'work')!.items[0].to).toBe(`/works/${w.id}`);
    const doc = flatten(quickFind(s, d.id)).find((i) => i.kind === 'doc')!;
    expect(doc.id).toBe(d.id);
    expect(doc.sub).toContain(d.type);
  });
  it('정렬: 앞부분 일치가 포함 일치보다 먼저', () => {
    const s = seed();
    const base = s.works[0];
    s.works.push({ ...base, id: 'W-900', name: '가나다' + base.name });
    const names = flatten(quickFind(s, base.name)).filter((i) => i.kind === 'work').map((i) => i.title);
    expect(names[0]).toBe(base.name);
    expect(names).toContain('가나다' + base.name);
  });
  it('종류별 최대 개수', () => {
    const s = seed();
    for (let i = 0; i < 12; i++) s.works.push({ ...s.works[0], id: `W-9${i}`, name: `반복업무 ${i}` });
    expect(quickFind(s, '반복업무').find((g) => g.kind === 'work')!.items.length).toBe(6);
  });
  it('보기 범위 밖 업무·문서는 제외(구성원 기준)', () => {
    const full = seed();
    // 개인 것: 다른 사람 전용으로 가려진 업무가 있다면 빠진다. 없으면 사용자별 범위가 전체보다 넓어지지 않음만 확인
    const user = full.users.find((u) => u.role !== 'lead')!;
    const view = scopeFor(full, user.id);
    const hidden = full.works.filter((w) => !view.works.some((x) => x.id === w.id));
    const found = flatten(quickFind(view, '')).length;
    expect(found).toBeGreaterThan(0);
    for (const w of hidden) expect(flatten(quickFind(view, w.id)).some((i) => i.id === w.id)).toBe(false);
    const hiddenDocs = full.docs.filter((d) => !view.docs.some((x) => x.id === d.id));
    for (const d of hiddenDocs) expect(flatten(quickFind(view, d.id)).some((i) => i.id === d.id)).toBe(false);
    // 직접 가려진 업무를 만들어 확인: 범위 함수가 거르는 업무는 찾기에도 없다
    const view2 = { ...view, works: view.works.slice(1) };
    expect(flatten(quickFind(view2, view.works[0].id)).some((i) => i.id === view.works[0].id)).toBe(false);
  });
  it('「나만 보기」 메모 내용은 찾지 않는다', () => {
    const s = seed();
    const w = s.works[0];
    expect(addPrivateMemo(s, w.id, 'U1', '비밀스러운고유문구', '2026-10-29T00:00:00Z')).toBe(true);
    expect(flatten(quickFind(scopeFor(s, 'U1'), '비밀스러운고유문구'))).toEqual([]);
  });
  it('사람은 조직·직위가 보조 설명', () => {
    const s = seed();
    const u = s.users[0];
    const p = flatten(quickFind(s, u.name)).find((i) => i.kind === 'person')!;
    expect(p.to).toBe('/people');
    expect(p.sub).toContain(' · ');
  });
  it('질문처럼 보이는 말', () => {
    expect(looksLikeQuestion('현재 추진 경과는?')).toBe(true);
    expect(looksLikeQuestion('백업')).toBe(false);
  });
});
