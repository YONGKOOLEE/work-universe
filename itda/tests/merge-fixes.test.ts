import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { applyMerge, checkIntegrity, planMerge, previewCounts, exportBackupState, replaceKeepingOtherMemos } from '../src/lib/mergeImport';
import { clone } from '../src/lib/util';
import type { AppState, Work } from '../src/lib/types';

// 합쳐 불러오기 독립 검토 A(2026-10-29) 반영 시험 — 가상 데이터만
const seed = () => createSeed('linked', new Date('2026-10-29T00:00:00Z'));
const stmt = (id: string, text: string) => ({ id, text, prov: 'owner' as const });
const dup = (w: Work, id: string, name: string, over: Partial<Work> = {}): Work => ({ ...clone(w), id, name, parentId: null, relatedIds: [], nextIds: [], ...over });

describe('H1 같은 이름 업무가 여럿일 때', () => {
  it('따로 두기로 들인 업무는 다음 불러오기에서 원본 ID로 그 업무에 맞춰지고, 원래 업무는 건드리지 않는다', () => {
    const cur = seed();
    const inc = clone(cur);
    const x = inc.works[0].id;
    const first = applyMerge(cur, inc, { works: { [x]: false } }).state;
    const added = first.works.find((w) => !cur.works.some((c) => c.id === w.id))!;
    expect(added.name).toBe(cur.works[0].name);
    const plan = planMerge(first, inc);
    const m = plan.works.find((w) => w.incomingId === x)!;
    expect(m.status).toBe('same');
    expect(m.currentId).toBe(added.id);
    const orig = JSON.stringify(first.works.find((w) => w.id === x));
    const second = applyMerge(first, inc).state;
    expect(JSON.stringify(second.works.find((w) => w.id === x))).toBe(orig);
    expect(second.works.length).toBe(first.works.length);
    expect(second.docs.length).toBe(first.docs.length);
    expect(second.actions.length).toBe(first.actions.length);
    expect(checkIntegrity(second)).toEqual([]);
  });

  it('한 파일에 같은 이름 업무 둘: 두 번째 불러오기에서도 서로 섞이지 않는다', () => {
    const cur = seed();
    const inc = clone(cur);
    inc.works.push(dup(inc.works[0], 'W-901', '중복이름 업무', { current: [stmt('s1', '첫째 업무 현황')] }), dup(inc.works[0], 'W-902', '중복이름 업무', { current: [stmt('s1', '둘째 업무 현황')] }));
    const first = applyMerge(cur, inc).state;
    const second = applyMerge(first, inc).state;
    const named = second.works.filter((w) => w.name === '중복이름 업무');
    expect(named.length).toBe(2);
    expect(named.map((w) => w.current.map((s) => s.text))).toEqual([['첫째 업무 현황'], ['둘째 업무 현황']]);
    expect(second.works.length).toBe(first.works.length);
  });

  it('원본 ID 기록이 없고 이름이 같은 지금 업무가 여럿이면 후보 — 기본은 따로 두기, 고르면 그 업무로 합친다', () => {
    const cur = seed();
    const twin = dup(cur.works[0], 'W-950', cur.works[0].name);
    cur.works.push(twin);
    const inc = seed();
    const id = inc.works[0].id;
    const plan = planMerge(cur, inc);
    const m = plan.works.find((w) => w.incomingId === id)!;
    expect(m.status).toBe('candidate');
    expect(m.options?.map((o) => o.id).sort()).toEqual([cur.works[0].id, 'W-950'].sort());
    const sep = applyMerge(cur, inc).state;
    expect(sep.works.length).toBe(cur.works.length + 1);
    const toTwin = applyMerge(cur, inc, { works: { [id]: true }, targets: { [id]: 'W-950' } }).state;
    expect(toTwin.works.length).toBe(cur.works.length);
    expect(toTwin.history.some((h) => h.workId === 'W-950' && h.kind === '합쳐 불러오기')).toBe(true);
    expect(checkIntegrity(toTwin)).toEqual([]);
  });
});

describe('H2 들어온 업무 둘이 같은 지금 업무로 갈 때', () => {
  it('둘째는 기본 따로 두기 — 내용이 버려지지 않고 합침 숫자가 실제와 맞다', () => {
    const cur = seed();
    const t = cur.works[0];
    t.cautions = [];
    t.agency = '';
    const inc = clone(cur);
    const a = inc.works[0];
    a.cautions = [stmt('c1', '가 유의사항')];
    a.agency = '가 기관';
    const b = dup(a, 'W-950', a.name + ' ', { cautions: [stmt('c2', '나 유의사항')], agency: '나 기관' });
    inc.works.push(b);
    const plan = planMerge(cur, inc);
    expect(plan.works.find((w) => w.incomingId === 'W-950')!.dupOf).toBe(a.id);
    const { state, summary } = applyMerge(cur, inc);
    const merged = state.works.find((w) => w.id === t.id)!;
    expect(merged.cautions.map((x) => x.text)).toEqual(['가 유의사항']);
    const second = state.works.find((w) => w.cautions.some((x) => x.text === '나 유의사항'));
    expect(second).toBeTruthy();
    expect(second!.id).not.toBe(t.id);
    expect(summary).toContain(`합침 ${cur.works.length})`);
    expect(previewCounts(cur, inc, plan, {}).worksMerged).toBe(cur.works.length);
    expect(checkIntegrity(state)).toEqual([]);
  });
});

describe('M1 지난번 결정 기억', () => {
  it('후보를 합치기로 정했으면 같은 파일을 다시 불러올 때 같은 업무로 본다', () => {
    const cur = seed();
    const inc = clone(cur);
    const iw = inc.works[0];
    iw.name = '이름을 조금 바꾼 업무';
    const t = cur.works[0];
    t.topics = [...(t.topics ?? []), '가상주제Q'];
    iw.topics = [...(iw.topics ?? []), '가상주제Q'];
    const s1 = applyMerge(cur, inc, { works: { [iw.id]: true } }).state;
    const p2 = planMerge(s1, inc).works.find((w) => w.incomingId === iw.id)!;
    expect(p2.status).toBe('same');
    expect(p2.currentId).toBe(t.id);
    const s2 = applyMerge(s1, inc).state;
    expect(s2.works.length).toBe(s1.works.length);
    expect(s2.docs.length).toBe(s1.docs.length);
    expect(s2.decisions.length).toBe(s1.decisions.length);
  });
});

describe('M2 건수', () => {
  it('모두 따로 두기: 미리 보기 건수가 실제로 늘어난 건수와 같다', () => {
    const a = seed();
    const b = clone(a);
    const works: Record<string, boolean> = {};
    for (const w of b.works) works[w.id] = false;
    const plan = planMerge(a, b);
    const c = previewCounts(a, b, plan, { works });
    const { state } = applyMerge(a, b, { works });
    expect(c.docs).toBe(state.docs.length - a.docs.length);
    expect(c.decisions).toBe(state.decisions.length - a.decisions.length);
    expect(c.actions).toBe(state.actions.length - a.actions.length);
    expect(c.docs).toBeGreaterThan(0);
  });
});

describe('L2 바뀐 것이 없으면 버전·날짜를 올리지 않는다', () => {
  it('같은 시드를 합쳐도 업무 version·updatedAt·순서가 그대로다', () => {
    const a = seed();
    const { state } = applyMerge(a, clone(a));
    expect(state.works.map((w) => [w.id, w.version, w.updatedAt])).toEqual(a.works.map((w) => [w.id, w.version, w.updatedAt]));
  });
  it('내용이 실제로 바뀐 업무만 version이 오른다', () => {
    const a = seed();
    const b = clone(a);
    b.works[0].current.push(stmt('s-new', '새로 더한 현재 사항'));
    const { state } = applyMerge(a, b);
    expect(state.works[0].version).toBe(a.works[0].version + 1);
    expect(state.works[1].version).toBe(a.works[1].version);
  });
});

describe('L1 사번 없는 사람', () => {
  it('같은 이름·부서인 지금 사람이 정확히 하나면 기본이 같은 사람 — 같은 파일을 두 번 불러와도 늘지 않는다', () => {
    const cur = seed();
    const inc = clone(cur);
    inc.users.push({ id: 'U90', name: '가상신규', dept: inc.users[0].dept, title: '주무관' });
    const s1 = applyMerge(cur, inc).state;
    const s2 = applyMerge(s1, inc).state;
    expect(s2.users.filter((u) => u.name === '가상신규').length).toBe(1);
  });
  it('같은 이름·부서인 지금 사람이 둘이면 기본은 다른 사람', () => {
    const cur = seed();
    cur.users.push({ id: 'U91', name: '가상쌍둥이', dept: cur.users[0].dept, title: '주무관' }, { id: 'U92', name: '가상쌍둥이', dept: cur.users[0].dept, title: '주무관' });
    const inc = clone(cur);
    inc.users = [{ id: 'U93', name: '가상쌍둥이', dept: cur.users[0].dept, title: '주무관' }];
    inc.works = [];
    inc.docs = [];
    inc.events = [];
    inc.decisions = [];
    inc.actions = [];
    inc.history = [];
    inc.handovers = [];
    inc.snapshots = [];
    const s = applyMerge(cur, inc).state;
    expect(s.users.filter((u) => u.name === '가상쌍둥이').length).toBe(3);
  });
});

describe('L9 자리표시 글', () => {
  it('지금 소관 기관이 「별도 확인 필요」이면 충돌이 아니라 채운다', () => {
    const cur = seed();
    cur.works[0].agency = '별도 확인 필요';
    const inc = clone(cur);
    inc.works[0].agency = '가상 기관';
    const plan = planMerge(cur, inc);
    expect(plan.conflicts.some((c) => c.field === 'agency')).toBe(false);
    expect(applyMerge(cur, inc).state.works[0].agency).toBe('가상 기관');
  });
  it('들어온 쪽이 자리표시 글이면 지금 값을 지킨다', () => {
    const cur = seed();
    cur.works[0].agency = '가상 기관';
    const inc = clone(cur);
    inc.works[0].agency = '별도 확인 필요';
    expect(planMerge(cur, inc).conflicts.some((c) => c.field === 'agency')).toBe(false);
    expect(applyMerge(cur, inc).state.works[0].agency).toBe('가상 기관');
  });
});

describe('M5·M6 합치기: 나만 보기 메모·지도 숨김은 가져오지 않고 밝힌다', () => {
  it('계획에 건수가 있고 요약에 한 줄로 나온다', () => {
    const cur = seed();
    cur.mapHidden = ['doc:X1'];
    const inc = clone(cur);
    inc.privateMemos = [
      { id: 'PM-1', workId: inc.works[0].id, userId: inc.users[0].id, text: '동료 개인 메모', at: '2026-10-29' },
      { id: 'PM-2', workId: inc.works[0].id, userId: inc.users[1].id, text: '또 다른 메모', at: '2026-10-29' },
    ];
    inc.mapHidden = ['doc:X2', 'work:W-002'];
    const plan = planMerge(cur, inc);
    expect(plan.skipped).toEqual({ privateMemos: 2, mapHidden: 2 });
    const { state, summary } = applyMerge(cur, inc);
    expect(state.privateMemos ?? []).toEqual([]);
    expect(state.mapHidden).toEqual(['doc:X1']);
    expect(summary).toContain('나만 보기 메모 2건');
    expect(summary).toContain('지도 숨김 2건');
  });
});

describe('내보내기·바꿔 불러오기의 나만 보기 메모', () => {
  const memo = (id: string, userId: string, text: string) => ({ id, workId: 'W-001', userId, text, at: '2026-10-29' });
  it('내보내기는 지금 사용자의 메모만 담고 원본은 바꾸지 않는다', () => {
    const s = seed();
    s.privateMemos = [memo('PM-1', s.currentUserId, '내 메모'), memo('PM-2', 'U2', '남의 메모')];
    const out = exportBackupState(s);
    expect(out.privateMemos?.map((m) => m.id)).toEqual(['PM-1']);
    expect(s.privateMemos.length).toBe(2);
  });
  it('바꿔 불러오기: 지금 브라우저의 다른 사용자 메모는 남고 지금 사용자 메모는 파일의 것으로 바뀐다', () => {
    const raw = seed();
    raw.privateMemos = [memo('PM-1', raw.currentUserId, '지금 내 옛 메모'), memo('PM-2', 'U2', '남의 메모')];
    const file: AppState = clone(seed());
    file.privateMemos = [memo('PM-9', file.currentUserId, '파일의 내 메모')];
    const next = replaceKeepingOtherMemos(raw, file);
    expect(next.privateMemos?.map((m) => m.id).sort()).toEqual(['PM-2', 'PM-9']);
    expect(file.privateMemos?.length).toBe(1);
  });
});
