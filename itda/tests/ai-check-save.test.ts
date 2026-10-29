// 마지막 AI 점검 결과 저장(AppState.aiChecks): 저장 모양, 오래됨, 이력·버전, 취소, 내보내기·migrate, 합쳐 불러오기 — 가짜 클라이언트만
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { claudeCheck } from '../src/ai/aiCheck';
import { createClient } from '../src/ai/llm';
import { cleanAiChecks, dropAiChecks, isAiCheckStale, makeAiCheckRecord, saveAiCheck } from '../src/lib/aiChecks';
import { migrate } from '../src/lib/migrate';
import { parseBackup } from '../src/lib/store';
import { applyMerge, exportBackupState } from '../src/lib/mergeImport';
import { removePerson } from '../src/lib/people';
import { uid } from '../src/lib/util';
import type { AppState } from '../src/lib/types';

const NOW = new Date('2026-10-29T09:00:00+09:00');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// store.tsx의 log와 같은 동작(버전·갱신일을 올리지 않고 이력만 더함)
function log(d: AppState, workId: string, kind: string, summary: string, actorId?: string) {
  d.history.push({ id: uid('H'), workId, at: new Date().toISOString(), actorId: actorId ?? d.currentUserId, kind, summary });
}

function fakeClient(output: unknown) {
  return createClient('test', 'fake-model', { messages: { parse: async () => ({ stop_reason: 'end_turn', parsed_output: output }) } });
}

/** 훅 run()의 저장 규칙을 순수 함수로: 성공하고 취소되지 않았을 때만 저장 */
async function runAndSave(s: AppState, workId: string, client: ReturnType<typeof fakeClient>, signal: AbortSignal, model = 'fake-model') {
  const ver = s.works.find((w) => w.id === workId)!.version;
  try {
    const r = await claudeCheck(client, s, workId, signal, NOW);
    if (signal.aborted) return null;
    const rec = makeAiCheckRecord(r, { at: '2026-10-29T05:32:00.000Z', byId: s.currentUserId, model, workVersion: ver });
    saveAiCheck(s, workId, rec, log);
    return rec;
  } catch {
    return null;
  }
}

const finding = (s: AppState, workId: string) => {
  const w = s.works.find((x) => x.id === workId)!;
  const line = w.summary || w.current[0]?.text || '';
  return { kind: 'risk', severity: 'high', title: '한 사람만 아는 절차', detail: '보완 필요', quote: line.slice(0, 20), ref: '기록#2' };
};

function seedWithCheck() {
  const s = createSeed('linked');
  const w = s.works.find((x) => x.summary)!;
  const rec = makeAiCheckRecord(
    { findings: [{ kind: 'risk', severity: 'high', title: 't', detail: 'd', quote: 'q'.repeat(15), cite: { docId: s.docs[0].id, label: 'x' }, recordLine: null }], dropped: 2 },
    { at: '2026-10-29T05:32:00.000Z', byId: s.currentUserId, model: 'fake-model', workVersion: w.version },
  );
  return { s, w, rec };
}

describe('AI 점검 저장 — 저장·이력', () => {
  it('성공한 결과만 저장: 모양·이력 한 줄·업무 버전 안 오름', async () => {
    const s = createSeed('linked');
    const w = s.works.find((x) => x.summary)!;
    const before = { v: w.version, u: w.updatedAt, n: s.history.length };
    const rec = await runAndSave(s, w.id, fakeClient({ findings: [finding(s, w.id)] }), new AbortController().signal);
    expect(rec).not.toBeNull();
    const saved = s.aiChecks![w.id];
    expect(saved).toMatchObject({ engine: 'claude', model: 'fake-model', byId: s.currentUserId, workVersion: before.v });
    expect(saved.findings).toHaveLength(1);
    expect(Object.keys(saved).sort()).toEqual(['at', 'byId', 'dropped', 'engine', 'findings', 'model', 'workVersion']);
    expect(JSON.stringify(saved)).not.toMatch(/sk-ant|apiKey|<업무 기록>/);
    expect(s.history.length).toBe(before.n + 1);
    const h = s.history[s.history.length - 1];
    expect(h).toMatchObject({ workId: w.id, kind: 'AI 점검', summary: `AI 점검 ${saved.findings.length}건 (Claude)` });
    expect(w.version).toBe(before.v);
    expect(w.updatedAt).toBe(before.u);
  });
  it('다시 점검하면 마지막 하나로 덮어쓴다', async () => {
    const s = createSeed('linked');
    const w = s.works.find((x) => x.summary)!;
    await runAndSave(s, w.id, fakeClient({ findings: [finding(s, w.id)] }), new AbortController().signal);
    await runAndSave(s, w.id, fakeClient({ findings: [] }), new AbortController().signal, 'm2');
    expect(Object.keys(s.aiChecks!)).toEqual([w.id]);
    expect(s.aiChecks![w.id].model).toBe('m2');
  });
  it('취소된 결과·실패는 저장하지 않고 지난 결과도 지우지 않는다', async () => {
    const { s, w, rec } = seedWithCheck();
    saveAiCheck(s, w.id, rec, log);
    const n = s.history.length;
    const c = new AbortController();
    const p = runAndSave(s, w.id, fakeClient({ findings: [] }), c.signal);
    c.abort();
    expect(await p).toBeNull();
    const failing = createClient('test', 'fake-model', { messages: { parse: async () => { throw new Error('boom'); } } });
    expect(await runAndSave(s, w.id, failing, new AbortController().signal)).toBeNull();
    expect(s.history.length).toBe(n);
    expect(s.aiChecks![w.id]).toEqual(rec);
  });
  it('없는 업무에는 저장하지 않는다', () => {
    const { s, rec } = seedWithCheck();
    expect(saveAiCheck(s, 'W-없음', rec, log)).toBe(false);
    expect(s.aiChecks).toBeUndefined();
  });
});

describe('AI 점검 저장 — 오래됨·정리', () => {
  it('점검 뒤 업무 version이 달라지면 오래됨', () => {
    const { w, rec } = seedWithCheck();
    expect(isAiCheckStale(rec, w)).toBe(false);
    expect(isAiCheckStale(rec, { version: w.version + 1 })).toBe(true);
    expect(isAiCheckStale(rec, undefined)).toBe(false);
  });
  it('업무 정리', () => {
    const { s, w, rec } = seedWithCheck();
    saveAiCheck(s, w.id, rec, log);
    dropAiChecks(s, w.id);
    expect(s.aiChecks).toBeUndefined();
  });
  // 변경(2026-10-29 검토): 점검을 한 번 했다는 이유만으로 사람 삭제를 막으면 너무 강하다 → 사용처에서 뺐다. 저장 결과 머리 줄은 사람이 없으면 「지워진 사람」으로 보인다
  it('점검한 사람이라도 그 저장 결과만으로는 지우기가 막히지 않는다', () => {
    const { s, w, rec } = seedWithCheck();
    const d = clone(s);
    d.users.push({ id: 'U9999', name: '시험 사람', dept: '시험', title: '대리' });
    saveAiCheck(d, w.id, { ...rec, byId: 'U9999' }, (x, wid, k, sm) => log(x, wid, k, sm, d.currentUserId));
    const r = removePerson(d, 'U9999');
    expect('blocked' in r && r.blocked.some((t) => t.includes('AI 점검'))).toBe(false);
  });
});

describe('AI 점검 저장 — 내보내기·migrate', () => {
  it('내보내기에 포함되고 불러오면 그대로 돌아온다', () => {
    const { s, w, rec } = seedWithCheck();
    saveAiCheck(s, w.id, rec, log);
    const text = JSON.stringify(exportBackupState(s));
    const back = parseBackup(text);
    expect(back.aiChecks![w.id]).toEqual(rec);
    expect(migrate(JSON.parse(text)).aiChecks![w.id]).toEqual(rec);
  });
  it('잘못된 모양은 버린다(없는 업무·틀린 칸·항목 모양)', () => {
    const { s, w, rec } = seedWithCheck();
    const bad = clone(s) as any;
    bad.aiChecks = {
      [w.id]: { ...rec, findings: [rec.findings[0], { kind: '??', title: 1 }, null] },
      'W-없음': rec,
      [s.works[1].id]: { at: 'x' },
      [s.works[2].id]: 'str',
    };
    const out = parseBackup(JSON.stringify(bad));
    expect(Object.keys(out.aiChecks!)).toEqual([w.id]);
    expect(out.aiChecks![w.id].findings).toHaveLength(1);
    const none = cleanAiChecks({ ...clone(s), aiChecks: [1, 2] } as any);
    expect('aiChecks' in none).toBe(false);
    expect('aiChecks' in parseBackup(JSON.stringify(s))).toBe(false);
  });
});

describe('AI 점검 저장 — 합쳐 불러오기', () => {
  it('새 업무는 새 ID로 옮기고, 합쳐진 업무는 지금 값을 유지한다', () => {
    const cur = createSeed('linked');
    const inc = clone(cur);
    // 들어온 쪽: 지금과 같은 업무(합쳐짐) 하나 + 지금에 없는 새 업무 하나(ID가 겹치게 이름만 다르게)
    const merged = inc.works[0];
    const incoming = clone(merged);
    incoming.id = 'W-900';
    incoming.name = '전혀 다른 새 업무 AI점검시험';
    incoming.summary = '새 업무 요약';
    incoming.importedFrom = undefined;
    inc.works = [merged, incoming];
    inc.docs = [];
    inc.events = [];
    inc.decisions = [];
    inc.actions = [];
    inc.handovers = [];
    inc.snapshots = [];
    inc.history = [];
    const mk = (model: string, workId: string, ver: number) => makeAiCheckRecord({ findings: [], dropped: 0 }, { at: '2026-10-29T05:00:00.000Z', byId: inc.currentUserId, model, workVersion: ver });
    inc.aiChecks = { [merged.id]: mk('incoming-m', merged.id, 1), 'W-900': mk('new-m', 'W-900', 3) };
    cur.aiChecks = { [merged.id]: mk('current-m', merged.id, merged.version) };
    const { state } = applyMerge(cur, inc, { works: { [merged.id]: true, 'W-900': false } });
    const created = state.works.find((w) => w.name === incoming.name)!;
    expect(created.id).toBeTruthy();
    expect(state.aiChecks![created.id].model).toBe('new-m');
    expect(state.aiChecks![merged.id].model).toBe('current-m');
    expect(Object.keys(state.aiChecks!)).toHaveLength(2);
  });
  it('ID가 겹치면 겹치지 않는 새 ID로 옮긴다', () => {
    const cur = createSeed('linked');
    const inc = createSeed('linked');
    const w0 = inc.works[0];
    inc.works = [{ ...w0, name: '이름이 다른 업무 겹침시험', summary: '다른 요약', importedFrom: undefined }];
    inc.docs = [];
    inc.events = [];
    inc.decisions = [];
    inc.actions = [];
    inc.handovers = [];
    inc.snapshots = [];
    inc.history = [];
    inc.aiChecks = { [w0.id]: makeAiCheckRecord({ findings: [], dropped: 0 }, { at: '2026-10-29T05:00:00.000Z', byId: inc.currentUserId, model: 'new-m', workVersion: 1 }) };
    const { state } = applyMerge(cur, inc, { works: { [w0.id]: false } });
    const created = state.works.find((w) => w.name === '이름이 다른 업무 겹침시험')!;
    expect(created.id).not.toBe(w0.id);
    expect(state.aiChecks![created.id].model).toBe('new-m');
    expect(state.aiChecks![w0.id]).toBeUndefined();
  });
});
