import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { applyMerge, checkIntegrity, planMerge } from '../src/lib/mergeImport';
import { clone } from '../src/lib/util';
import type { AppState, Handover, Snapshot } from '../src/lib/types';

/** 시드 + 인계·스냅샷 한 건(인계 쪽 참조 변환도 시험하려고 덧붙임) */
function withHandover(s: AppState): AppState {
  const w = s.works[0];
  const ho: Handover = {
    id: 'HO-T01', workId: w.id, fromId: s.users[0].id, toId: s.users[1].id, baseDate: '2026-10-01', status: 'confirmed', step: 8,
    precheckDone: true, checklist: {}, supplement: '', fromLeaves: true, snapshotId: 'SN-T01', createdAt: '2026-10-01T00:00:00Z',
    requests: [{ id: 'RQ-1', at: '2026-10-02T00:00:00Z', byId: s.users[1].id, text: '확인 요청' }],
    log: [{ at: '2026-10-02T00:00:00Z', byId: s.users[0].id, text: '제출' }],
  };
  const sn: Snapshot = {
    id: 'SN-T01', handoverId: 'HO-T01', workId: w.id, takenAt: '2026-10-01T00:00:00Z', version: w.version,
    work: clone(w), decisions: clone(s.decisions.filter((d) => d.workId === w.id)), actions: clone(s.actions.filter((a) => a.workId === w.id)),
    events: clone(s.events.filter((e) => e.workIds.includes(w.id))), docs: s.docs.filter((d) => d.workIds.includes(w.id)).map((d) => ({ id: d.id, title: d.title, type: d.type, writtenAt: d.writtenAt, availability: d.availability })),
  };
  s.handovers.push(ho);
  s.snapshots.push(sn);
  return s;
}
const seed = () => withHandover(createSeed('linked', new Date('2026-10-29T00:00:00Z')));

/** 동료 데이터: 다른 사번의 사람 + 다른 업무(ID는 지금 데이터와 겹침) */
function colleague(): AppState {
  const s = seed();
  s.users = s.users.map((u, i) => ({ ...u, name: `가상동료${i}`, empNo: `V-${2001 + i}` }));
  s.currentUserId = 'U1';
  s.works.forEach((w, i) => {
    w.name = `동료 업무 ${i}`;
    w.owners = ['U1'];
    w.ownerHistory = w.ownerHistory.map((o) => ({ ...o }));
  });
  s.docs.forEach((d) => (d.title = `동료 ${d.title}`));
  s.decisions.forEach((d) => (d.title = `동료 ${d.title}`));
  s.actions.forEach((a) => (a.title = `동료 ${a.title}`));
  s.events.forEach((e) => (e.title = `동료 ${e.title}`));
  s.history.forEach((h) => (h.summary = `동료 ${h.summary}`));
  return s;
}

describe('합쳐 불러오기', () => {
  it('시드가 무결하다(시험 전제)', () => {
    expect(checkIntegrity(seed())).toEqual([]);
    expect(checkIntegrity(colleague())).toEqual([]);
  });

  it('같은 시드 두 벌: 사번이 같아 같은 사람, 이름이 같아 업무 합침, 중복 없이 그대로', () => {
    const a = seed();
    const b = seed();
    const plan = planMerge(a, b);
    expect(plan.people.every((p) => p.status === 'same')).toBe(true);
    expect(plan.works.every((w) => !!w.currentId)).toBe(true);
    const { state, summary } = applyMerge(a, b);
    expect(checkIntegrity(state)).toEqual([]);
    expect(state.users.length).toBe(a.users.length);
    expect(state.works.length).toBe(a.works.length);
    expect(state.docs.length).toBe(a.docs.length);
    expect(state.decisions.length).toBe(a.decisions.length);
    expect(state.actions.length).toBe(a.actions.length);
    expect(state.events.length).toBe(a.events.length);
    expect(state.handovers.length).toBe(a.handovers.length); // 같은 인계(업무·인계자·인수자·기준일)는 다시 더하지 않음(검토 2026-10-29 높음 2)
    expect(state.works[0].version).toBe(a.works[0].version + 1);
    expect(state.history.at(-1)?.kind).toBe('합쳐 불러오기');
    expect(summary).toContain(`같은 사람 ${a.users.length}`);
    expect(summary).toContain(`합침 ${a.works.length}`);
  });

  it('같은 시드를 업무 따로 두기로 합치면 ID가 새로 매겨지고 모든 참조가 맞는다', () => {
    const a = seed();
    const b = seed();
    const works: Record<string, boolean> = {};
    b.works.forEach((w) => (works[w.id] = false));
    const { state } = applyMerge(a, b, { works });
    expect(state.works.length).toBe(a.works.length + b.works.length);
    expect(state.docs.length).toBe(a.docs.length + b.docs.length);
    expect(state.handovers.length).toBe(a.handovers.length + b.handovers.length);
    expect(checkIntegrity(state)).toEqual([]);
    const newHo = state.handovers.find((h) => h.id !== 'HO-T01')!;
    const newSn = state.snapshots.find((s) => s.id === newHo.snapshotId)!;
    expect(newSn.handoverId).toBe(newHo.id);
    expect(newSn.workId).toBe(newHo.workId);
    expect(newSn.work.id).toBe(newHo.workId);
    expect(newHo.workId).not.toBe(a.works[0].id);
  });

  it('동료 데이터(다른 사번·다른 업무, ID 겹침): 새 사람·새 업무로 더해지고 참조 무결', () => {
    const a = seed();
    const b = colleague();
    const plan = planMerge(a, b);
    expect(plan.people.every((p) => p.status === 'new')).toBe(true);
    expect(plan.works.every((w) => !w.currentId)).toBe(true);
    const { state } = applyMerge(a, b);
    expect(checkIntegrity(state)).toEqual([]);
    expect(state.users.length).toBe(a.users.length + b.users.length);
    expect(state.works.length).toBe(a.works.length + b.works.length);
    expect(state.docs.length).toBe(a.docs.length + b.docs.length);
    expect(state.currentUserId).toBe(a.currentUserId);
    const added = state.works.filter((w) => w.name.startsWith('동료 업무'));
    expect(added.length).toBe(b.works.length);
    for (const w of added) {
      const u = state.users.find((x) => w.owners.includes(x.id))!;
      expect(u.empNo).toBe('V-2001');
    }
  });

  it('empNo 맞추기: 공백·소문자도 같은 사번', () => {
    const a = seed();
    const b = colleague();
    b.users[0].empNo = ' v-1001 ';
    const plan = planMerge(a, b);
    expect(plan.people[0]).toMatchObject({ status: 'same', currentId: a.users.find((u) => u.empNo === 'V-1001')!.id });
    const { state } = applyMerge(a, b);
    expect(state.users.length).toBe(a.users.length + b.users.length - 1);
    expect(checkIntegrity(state)).toEqual([]);
  });

  it('이름+부서만 같고 사번이 없으면 확인 필요 — 선택에 따라 같은 사람/다른 사람', () => {
    const a = seed();
    const b = colleague();
    b.users[0] = { ...b.users[0], name: a.users[0].name, dept: a.users[0].dept, empNo: undefined };
    const plan = planMerge(a, b);
    expect(plan.people[0].status).toBe('candidate');
    expect(plan.people[0].currentId).toBe(a.users[0].id);
    expect(applyMerge(a, b).state.users.length).toBe(a.users.length + b.users.length); // 기본: 다른 사람
    const same = applyMerge(a, b, { people: { [b.users[0].id]: true } });
    expect(same.state.users.length).toBe(a.users.length + b.users.length - 1);
    expect(checkIntegrity(same.state)).toEqual([]);
  });

  it('사번이 서로 다르면 이름·부서가 같아도 새 사람', () => {
    const a = seed();
    const b = colleague();
    b.users[0] = { ...b.users[0], name: a.users[0].name, dept: a.users[0].dept, empNo: 'V-9999' };
    expect(planMerge(a, b).people[0].status).toBe('new');
  });

  it('업무 합치기: 지금 업무 기준 합집합, 빈 서술만 채움, 들어온 문서·조치가 합친 업무로 옮겨짐', () => {
    const a = seed();
    const b = colleague();
    const target = a.works[0];
    target.purpose = [];
    target.keywords = ['지금키워드'];
    const incW = b.works[0];
    incW.name = ` ${target.name.toUpperCase()} `;
    incW.keywords = ['동료키워드'];
    incW.topics = ['동료주제'];
    const incPurpose = incW.purpose.length;
    incW.current = [{ id: 'S-X', text: '들어온 현황', prov: 'owner' }];
    const plan = planMerge(a, b);
    expect(plan.works[0].currentId).toBe(target.id);
    const { state } = applyMerge(a, b);
    expect(checkIntegrity(state)).toEqual([]);
    const m = state.works.find((w) => w.id === target.id)!;
    expect(m.keywords).toEqual(expect.arrayContaining(['지금키워드', '동료키워드']));
    expect(m.topics).toContain('동료주제');
    expect(m.purpose.length).toBe(incPurpose); // 비어 있어 들어온 것으로 채워짐
    expect(m.current).toEqual(target.current); // 지금 것이 있으면 유지
    const newcomer = state.users.find((u) => u.empNo === 'V-2001')!;
    expect(m.owners).toContain(newcomer.id);
    expect(m.owners).toEqual(expect.arrayContaining(target.owners));
    expect(state.works.length).toBe(a.works.length + b.works.length - 1);
    expect(state.docs.filter((d) => d.title.startsWith('동료') && d.workIds.includes(target.id)).length).toBeGreaterThan(0);
    const incActs = b.actions.filter((x) => x.workId === incW.id).map((x) => x.title);
    expect(state.actions.filter((x) => incActs.includes(x.title)).every((x) => x.workId === target.id)).toBe(true);
  });

  it('업무 후보를 따로 두기로 하면 새 업무로 추가된다', () => {
    const a = seed();
    const b = colleague();
    b.works[0].name = a.works[0].name;
    const joined = applyMerge(a, b);
    const split = applyMerge(a, b, { works: { [b.works[0].id]: false } });
    expect(split.state.works.length).toBe(joined.state.works.length + 1);
    expect(checkIntegrity(split.state)).toEqual([]);
    expect(checkIntegrity(joined.state)).toEqual([]);
  });

  it('문서 중복 방지: 같은 제목+작성일이 같은 업무에 있으면 한 번만, 작성일이 다르면 추가', () => {
    const a = seed();
    const b = seed();
    b.docs[0].writtenAt = '1999-01-01';
    const { state } = applyMerge(a, b);
    expect(state.docs.length).toBe(a.docs.length + 1);
    expect(checkIntegrity(state)).toEqual([]);
  });

  it('합쳐진 쪽 문서 인용(cite)도 새 문서 ID를 가리킨다', () => {
    const a = seed();
    const b = seed();
    const works: Record<string, boolean> = {};
    b.works.forEach((w) => (works[w.id] = false));
    const { state } = applyMerge(a, b, { works });
    const citeIds = state.decisions.flatMap((d) => d.cite.map((c) => c.docId));
    expect(citeIds.every((id) => state.docs.some((d) => d.id === id))).toBe(true);
  });

  it('원본 객체(지금·들어온)를 바꾸지 않는다', () => {
    const a = seed();
    const b = colleague();
    const ja = JSON.stringify(a);
    const jb = JSON.stringify(b);
    applyMerge(a, b);
    expect(JSON.stringify(a)).toBe(ja);
    expect(JSON.stringify(b)).toBe(jb);
  });

  it('currentUserId·focus·searchLog 유지, mapHidden 합집합', () => {
    const a = seed();
    const b = colleague();
    a.mapHidden = ['doc:X1'];
    b.mapHidden = ['doc:X2'];
    a.searchLog = ['지금검색'];
    b.searchLog = ['동료검색'];
    const { state } = applyMerge(a, b);
    expect(state.currentUserId).toBe(a.currentUserId);
    expect(state.focus).toEqual(a.focus);
    expect(state.searchLog).toEqual(['지금검색']);
    expect(state.mapHidden).toEqual(expect.arrayContaining(['doc:X1', 'doc:X2']));
  });

  it('같은 동료 데이터를 두 번 합쳐도 무결하고 사람·업무·문서가 늘지 않는다', () => {
    const a = seed();
    const b = colleague();
    const once = applyMerge(a, b).state;
    const twice = applyMerge(once, b).state;
    expect(checkIntegrity(twice)).toEqual([]);
    expect(twice.works.length).toBe(once.works.length);
    expect(twice.docs.length).toBe(once.docs.length);
    expect(twice.users.length).toBe(once.users.length);
  });
});

describe('합쳐 불러오기 — 검토 반영(2026-10-29)', () => {
  it('같은 백업을 두 번 합쳐도 인계·스냅샷이 늘지 않는다', async () => {
    const { applyMerge, planMerge } = await import('../src/lib/mergeImport');
    const { createSeed } = await import('../src/data/seed');
    const base = createSeed('linked');
    const once = applyMerge(base, createSeed('linked'), {}).state;
    const twice = applyMerge(once, createSeed('linked'), {}).state;
    expect(once.handovers.length).toBe(base.handovers.length);
    expect(twice.snapshots.length).toBe(base.snapshots.length);
    expect(planMerge(base, createSeed('linked')).counts.handovers).toBe(0);
  });
  it('들어온 상위 연결이 순환을 만들면 붙이지 않는다', async () => {
    const { applyMerge } = await import('../src/lib/mergeImport');
    const { createSeed } = await import('../src/data/seed');
    const cur = createSeed('linked');
    const inc = createSeed('linked');
    const child = cur.works.find((w) => w.parentId)!; // 지금: child의 상위가 parent
    const parentId = child.parentId!;
    // 들어온 쪽: parent의 상위가 child, child는 상위 없음
    inc.works.find((w) => w.id === parentId)!.parentId = child.id;
    inc.works.find((w) => w.id === child.id)!.parentId = null;
    cur.works.find((w) => w.id === parentId)!.parentId = null;
    const out = applyMerge(cur, inc, {}).state;
    const p = out.works.find((w) => w.id === parentId)!;
    const c = out.works.find((w) => w.id === child.id)!;
    expect(p.parentId === c.id && c.parentId === p.id).toBe(false);
  });
});
