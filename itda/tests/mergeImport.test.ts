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
    // 이름이 같은 업무는 없다. 비슷한 업무 후보(점수)는 나올 수 있지만 기본은 따로 두기(2026-10-29 유니버스 점수 판정)
    expect(plan.works.every((w) => w.status !== 'same')).toBe(true);
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
    expect(m.current.map((x) => x.text)).toEqual([...target.current.map((x) => x.text), '들어온 현황']); // 서술은 기본 둘 다 남김(2026-10-29 변경: 지금 것만 유지하던 동작 대체)
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

describe('합쳐 불러오기 — 비슷한 업무 후보(유니버스 점수)', () => {
  it('이름이 달라도 주제·이름 낱말이 겹치면 후보로 보이고, 기본은 따로 두기, 고르면 합친다', () => {
    const a = createSeed('linked');
    const b = createSeed('linked');
    const w = b.works.find((x) => x.id === 'W-004')!;
    w.name = '출금이체 정산 월간 업무'; // 원래 「출금이체 월 정산」
    const plan = planMerge(a, b);
    const m = plan.works.find((x) => x.incomingId === 'W-004')!;
    expect(m.status).toBe('candidate');
    expect(m.currentId).toBe('W-004');
    expect(m.score).toBeGreaterThanOrEqual(3);
    expect(m.reason).toContain('같은 주제');
    const sep = applyMerge(a, b).state;
    expect(sep.works.filter((x) => x.name === '출금이체 정산 월간 업무').length).toBe(1); // 따로 더해짐
    const merged = applyMerge(a, b, { works: { 'W-004': true } }).state;
    expect(merged.works.some((x) => x.name === '출금이체 정산 월간 업무')).toBe(false);
    expect(checkIntegrity(merged)).toEqual([]);
  });
  it('겹치는 것이 기준 점수 밑이면 새 업무', () => {
    const a = createSeed('linked');
    const b = createSeed('linked');
    const w = b.works.find((x) => x.id === 'W-004')!;
    w.name = '전혀 다른 일';
    w.topics = [];
    b.docs.forEach((d) => (d.workIds = d.workIds.filter((x) => x !== 'W-004')));
    expect(planMerge(a, b).works.find((x) => x.incomingId === 'W-004')!.status).toBe('new');
  });
});

describe('합쳐 불러오기 — 같은 칸을 다르게 고친 경우(2026-10-29)', () => {
  /** 같은 이름 업무를 양쪽에서 다르게 고친 가상 데이터 */
  function edited() {
    const a = seed();
    const b = colleague();
    const t = a.works[0];
    const w = b.works[0];
    w.name = t.name;
    t.current = [{ id: 's1', text: '지금 현황 가', prov: 'owner' }, { id: 's2', text: '공통 현황', prov: 'owner' }];
    w.current = [{ id: 's1', text: '가져온 현황 나', prov: 'owner' }, { id: 's9', text: ' 공통  현황 ', prov: 'owner' }];
    t.summary = '지금 요약';
    w.summary = '가져온 요약';
    w.agency = t.agency;
    w.status = t.status;
    w.type = t.type;
    return { a, b, t, w };
  }
  const key = (id: string, f: string) => `${id}|${f}`;

  it('계획에 다른 칸이 나오고, 같은 내용인 칸은 나오지 않는다', () => {
    const { a, b, w } = edited();
    const cf = planMerge(a, b).conflicts.filter((c) => c.incomingWorkId === w.id);
    expect(cf.map((c) => c.field).sort()).toEqual(['current', 'summary']);
    expect(cf.find((c) => c.field === 'current')).toMatchObject({ kind: 'list', label: '현재 진행 중인 사항' });
    expect(cf.find((c) => c.field === 'summary')).toMatchObject({ kind: 'scalar', label: '업무 요약', current: '지금 요약', incoming: '가져온 요약' });
  });

  it('기본: 서술은 둘 다 남기되 같은 문장은 한 번만·ID 겹침 없음, 한 값은 지금 것, 기록이 남는다', () => {
    const { a, b, t } = edited();
    const { state, summary } = applyMerge(a, b);
    const m = state.works.find((x) => x.id === t.id)!;
    expect(m.current.map((x) => x.text)).toEqual(['지금 현황 가', '공통 현황', '가져온 현황 나']);
    expect(new Set(m.current.map((x) => x.id)).size).toBe(3);
    expect(m.summary).toBe('지금 요약');
    const h = state.history.find((x) => x.workId === t.id && x.summary.includes('현재 진행 중인 사항 두 쪽 내용 함께 남김'))!;
    expect(h.summary).toContain('업무 요약 지금 것 유지');
    expect(summary).toContain('내용이 다른 업무 1건');
    expect(checkIntegrity(state)).toEqual([]);
  });

  it('선택: 지금 것 / 가져온 것 / 둘 다', () => {
    const { a, b, t, w } = edited();
    const run = (fields: Record<string, 'both' | 'current' | 'incoming'>) => applyMerge(a, b, { fields }).state.works.find((x) => x.id === t.id)!;
    const cur = run({ [key(w.id, 'current')]: 'current', [key(w.id, 'summary')]: 'current' });
    expect(cur.current.map((x) => x.text)).toEqual(['지금 현황 가', '공통 현황']);
    const inc = run({ [key(w.id, 'current')]: 'incoming', [key(w.id, 'summary')]: 'incoming' });
    expect(inc.current.map((x) => x.text)).toEqual(['가져온 현황 나', ' 공통  현황 ']);
    expect(inc.summary).toBe('가져온 요약');
    const both = run({ [key(w.id, 'current')]: 'both' });
    expect(both.current.length).toBe(3);
    const r = applyMerge(a, b, { fields: { [key(w.id, 'summary')]: 'incoming' } });
    expect(r.state.history.some((x) => x.summary.includes('업무 요약 가져온 것으로 바꿈'))).toBe(true);
    expect(checkIntegrity(r.state)).toEqual([]);
  });

  it('후보 업무의 다른 칸은 계획에 있고, 합치기를 골랐을 때만 적용된다', () => {
    const { a, b, t, w } = edited();
    w.name = '전혀 다른 이름 업무';
    w.topics = [...(t.topics ?? []), '가상주제1', '가상주제2'];
    t.topics = [...(t.topics ?? []), '가상주제1', '가상주제2'];
    const plan = planMerge(a, b);
    const m = plan.works.find((x) => x.incomingId === w.id)!;
    expect(m.status).toBe('candidate');
    expect(plan.conflicts.some((c) => c.incomingWorkId === w.id && c.field === 'summary')).toBe(true);
    const sep = applyMerge(a, b);
    expect(sep.state.works.find((x) => x.id === t.id)!.current.length).toBe(2);
    expect(sep.state.history.some((x) => x.summary.includes('두 쪽 내용 함께'))).toBe(false);
    const joined = applyMerge(a, b, { works: { [w.id]: true }, fields: { [key(w.id, 'summary')]: 'incoming' } });
    const jm = joined.state.works.find((x) => x.id === t.id)!;
    expect(jm.summary).toBe('가져온 요약');
    expect(jm.current.length).toBe(3);
    expect(checkIntegrity(joined.state)).toEqual([]);
  });

  it('같은 시드 두 벌은 다른 칸이 없고 기록도 늘지 않는다', () => {
    const a = seed();
    const b = seed();
    expect(planMerge(a, b).conflicts).toEqual([]);
    const { state } = applyMerge(a, b);
    expect(state.history.length).toBe(a.history.length + 1);
  });
});
