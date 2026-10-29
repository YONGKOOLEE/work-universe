// 독립 검토(2026-10-29 b) 반영 검증 — 가상 데이터·가짜 클라이언트만. 화면(React) 동작은 단위로 못 보는 부분을 제외하고 순수 함수로 확인한다.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { affectedWorkIds, deleteDoc, forgetTombFor } from '../src/lib/docDelete';
import { cleanAiChecks, isAiCheckStale, linkedDocIds, makeAiCheckRecord, saveAiCheck } from '../src/lib/aiChecks';
import { applyMerge, checkIntegrity } from '../src/lib/mergeImport';
import { canDeleteDoc, canEdit, docDeleteAccess } from '../src/lib/store';
import { clone, uid } from '../src/lib/util';
import type { AppState } from '../src/lib/types';

const NOW = new Date('2026-10-29T00:00:00Z');
const AT = '2026-10-29T09:00:00.000Z';
const seed = () => createSeed('linked', NOW);
const log = (d: AppState, workId: string, kind: string, summary: string, actorId?: string) => {
  d.history.push({ id: uid('H'), workId, at: AT, actorId: actorId ?? d.currentUserId, kind, summary });
};
const rec = (s: AppState, workId: string, extra: Partial<{ docIds: string[]; cite: string }> = {}) =>
  makeAiCheckRecord(
    { findings: [{ kind: 'risk', severity: 'high', title: 't', detail: 'd', quote: 'q'.repeat(15), cite: extra.cite ? { docId: extra.cite } : null, recordLine: null }], dropped: 0 },
    { at: AT, byId: s.currentUserId, model: 'm', workVersion: s.works.find((w) => w.id === workId)!.version, docIds: extra.docIds },
  );

describe('1 권한 — 고칠 수 없는 사람의 AI 점검은 저장·이력 없음', () => {
  it('canEdit이 false면 saveAiCheck는 저장하지 않고 이력도 쓰지 않는다', () => {
    const s = seed();
    const w = s.works.find((x) => x.summary)!;
    const other = s.users.find((u) => !canEdit(s, w.id, u.id))!;
    expect(other).toBeTruthy();
    const n = s.history.length;
    const ok = saveAiCheck(s, w.id, rec(s, w.id), log, canEdit(s, w.id, other.id));
    expect(ok).toBe(false);
    expect(s.aiChecks).toBeUndefined();
    expect(s.history.length).toBe(n);
    // 담당자는 저장된다
    expect(saveAiCheck(s, w.id, rec(s, w.id), log, canEdit(s, w.id, w.owners[0]))).toBe(true);
    expect(s.history.length).toBe(n + 1);
  });
});

describe('3 문서 삭제 — 영향 받는 모든 업무를 고칠 수 있을 때만', () => {
  const DOC = 'D-105'; // 올린 U7, 연결 W-007
  function withForeignCite() {
    const s = seed();
    const w2 = s.works.find((w) => w.id !== 'W-007' && !canEdit(s, w.id, 'U7'))!;
    // 연결은 안 됐지만 이 문서를 인용한 다른 사람 업무
    w2.cautions.push({ id: 'sx', text: '시험 인용', prov: 'fact', cite: [{ docId: DOC }] });
    return { s, w2 };
  }
  it('인용한 업무까지 모두 고칠 수 있어야 가능. 올린 사람이어도 못 고치는 업무가 걸리면 불가(단추는 보이되 막음)', () => {
    const { s, w2 } = withForeignCite();
    expect(affectedWorkIds(s, DOC)).toEqual(expect.arrayContaining(['W-007', w2.id]));
    expect(canDeleteDoc(s, DOC, 'U7')).toBe(false);
    const a = docDeleteAccess(s, DOC, 'U7');
    expect(a.ok).toBe(false);
    expect(a.show).toBe(true);
    expect(a.blocked.map((b) => b.id)).toEqual([w2.id]);
    // w2는 고치지만 W-007은 못 고치는 사람 → 일부만 고침: 보이되 막음
    const part = s.users.find((u) => canEdit(s, w2.id, u.id) && !canEdit(s, 'W-007', u.id) && u.id !== 'U7');
    if (part) {
      const p = docDeleteAccess(s, DOC, part.id);
      expect(p.ok).toBe(false);
      expect(p.show).toBe(true);
    }
  });
  it('하나도 못 고치는 사람에게는 숨김, 영향 업무를 모두 고칠 수 있으면 허용', () => {
    const { s, w2 } = withForeignCite();
    const none = s.users.find((u) => u.id !== 'U7' && !canEdit(s, 'W-007', u.id) && !canEdit(s, w2.id, u.id))!;
    expect(docDeleteAccess(s, DOC, none.id)).toMatchObject({ ok: false, show: false });
    // 두 업무 모두 담당자로 만들면 허용
    s.works.find((w) => w.id === w2.id)!.owners.push('U7');
    expect(canDeleteDoc(s, DOC, 'U7')).toBe(true);
    expect(docDeleteAccess(s, DOC, 'U7').blocked).toEqual([]);
  });
  it('affectedWorkIds는 deleteDoc이 이력을 쓰는 업무와 같다', () => {
    const { s } = withForeignCite();
    const ids = new Set(affectedWorkIds(s, DOC));
    const before = s.history.length;
    const n = deleteDoc(s, DOC, 'U7', AT);
    const logged = new Set(n.history.slice(before).filter((h) => h.kind === '문서 삭제').map((h) => h.workId));
    expect(logged).toEqual(ids);
  });
});

describe('4 지운 문서를 같은 제목·작성일로 다시 올림', () => {
  const DOC = 'D-OCOU0';
  function reuploaded(forget: boolean) {
    const colleague = seed();
    const mine = deleteDoc(seed(), DOC, 'U1', AT);
    const orig = colleague.docs.find((d) => d.id === DOC)!;
    mine.docs.push({ ...clone(orig), id: 'D-NEW01' });
    if (forget) forgetTombFor(mine, orig);
    return { colleague, mine };
  }
  it('(a) 새로 등록하면 같은 열쇠의 삭제 기록이 지워진다(인계 스냅샷이 옛 ID를 가리키면 남긴다)', () => {
    const { mine } = reuploaded(true);
    const hasSnap = JSON.stringify(mine.snapshots).includes(`"${DOC}"`);
    expect((mine.deletedDocs ?? []).length).toBe(hasSnap ? 1 : 0);
  });
  it('(b) 삭제 기록이 남아 있어도 지금 문서와 같으면 그 문서로 맞추고 인용을 삭제 처리하지 않는다', () => {
    const { colleague, mine } = reuploaded(false);
    expect(mine.deletedDocs).toHaveLength(1);
    const noteBefore = JSON.stringify(mine.works).split('원문 문서 삭제됨').length;
    const { state } = applyMerge(mine, colleague);
    expect(state.docs.filter((d) => d.title === colleague.docs.find((x) => x.id === DOC)!.title)).toHaveLength(1);
    expect(JSON.stringify(state.works).split('원문 문서 삭제됨').length).toBe(noteBefore); // 새로 생긴 삭제 처리 없음
    expect(checkIntegrity(state).filter((x) => x.includes(DOC))).toEqual([]);
  });
});

describe('5 오래됨 — 연결 문서 목록이 바뀌어도', () => {
  it('version이 같아도 연결 문서가 달라지면 오래됨, docIds 없는 옛 기록은 version만', () => {
    const s = seed();
    const w = s.works.find((x) => x.summary)!;
    const ids = linkedDocIds(s.docs, w.id);
    const r = rec(s, w.id, { docIds: ids });
    expect(isAiCheckStale(r, w, s.docs)).toBe(false);
    const d2 = clone(s);
    d2.docs.push({ ...clone(d2.docs[0]), id: 'D-ADD01', workIds: [w.id] });
    expect(isAiCheckStale(r, d2.works.find((x) => x.id === w.id), d2.docs)).toBe(true);
    const old = { workVersion: r.workVersion };
    expect(isAiCheckStale(old, d2.works.find((x) => x.id === w.id), d2.docs)).toBe(false);
  });
  it('cleanAiChecks는 문자열 배열 docIds만 받는다', () => {
    const s = seed();
    const w = s.works[0];
    const mk = (docIds: unknown) => ({ ...clone(s), aiChecks: { [w.id]: { ...rec(s, w.id), docIds } } }) as unknown as AppState;
    expect(cleanAiChecks(mk(['D-2', 'D-1'])).aiChecks![w.id].docIds).toEqual(['D-1', 'D-2']);
    expect(cleanAiChecks(mk([1, 'D-1'])).aiChecks![w.id].docIds).toBeUndefined();
    expect(cleanAiChecks(mk('x')).aiChecks![w.id].docIds).toBeUndefined();
  });
});

describe('5·8 합쳐 불러오기 — AI 점검의 docIds·인용', () => {
  const NAME = '이름이 다른 업무 점검인용시험';
  function newWorkMerge(cite: string | undefined, docIds: string[] | undefined) {
    const cur = seed();
    const inc = seed();
    const w0 = inc.works[0];
    inc.works = [{ ...w0, name: NAME, summary: '다른 요약', importedFrom: undefined }];
    inc.docs = [];
    inc.events = [];
    inc.decisions = [];
    inc.actions = [];
    inc.handovers = [];
    inc.snapshots = [];
    inc.history = [];
    inc.aiChecks = { [w0.id]: rec(inc, w0.id, { cite, docIds }) };
    const { state } = applyMerge(cur, inc, { works: { [w0.id]: false } });
    return { state, created: state.works.find((w) => w.name === NAME)! };
  }
  it('(8) 대응이 없는 문서 ID의 인용은 null — 지금 데이터의 다른 문서(같은 ID)로 이어지지 않는다', () => {
    const existing = seed().docs[0].id; // 지금 데이터에 같은 ID 문서가 있다
    const { state, created } = newWorkMerge(existing, undefined);
    const f = state.aiChecks![created.id].findings[0];
    expect(f.cite).toBeNull();
    expect(f.recordLine).toBeNull();
    expect(f.quote).toBe('q'.repeat(15));
  });
  it('(5) docIds에서 대응 없는 것은 뺀다', () => {
    const { state, created } = newWorkMerge(undefined, ['D-NONE1']);
    expect(state.aiChecks![created.id].docIds).toEqual([]);
  });
});
