// 올린 문서 삭제(사용자 결정 2026-10-29: 삭제 + 반영 내용은 남김). 가상 데이터만.
import { describe, expect, it } from 'vitest';
import { createSeed } from '../src/data/seed';
import { deleteDoc, deleteImpact, deletedNote } from '../src/lib/docDelete';
import { applyMerge, checkIntegrity, exportBackupState, planMerge, skippedLine } from '../src/lib/mergeImport';
import { migrate } from '../src/lib/migrate';
import { canDeleteDoc, parseBackup, scopeFor } from '../src/lib/store';
import { clone } from '../src/lib/util';
import type { AppState, Cite, Snapshot } from '../src/lib/types';

const NOW = new Date('2026-10-29T00:00:00Z');
const AT = '2026-10-29T09:00:00.000Z';
const seed = () => createSeed('linked', NOW);
const DOC = 'D-OCOU0';
const citesDoc = (cs: Cite[] | undefined, id = DOC) => !!cs?.some((c) => c.docId === id);

function anyRef(s: AppState, id: string): string[] {
  const hits: string[] = [];
  const j = (x: unknown) => JSON.stringify(x).includes(`"${id}"`);
  for (const w of s.works) if (j(w)) hits.push(`work ${w.id}`);
  for (const d of s.decisions) if (j(d)) hits.push(`decision ${d.id}`);
  for (const a of s.actions) if (j(a)) hits.push(`action ${a.id}`);
  for (const e of s.events) if (j(e)) hits.push(`event ${e.id}`);
  for (const d of s.docs) if (j(d)) hits.push(`doc ${d.id}`);
  return hits;
}

describe('deleteImpact', () => {
  it('영향 건수를 센다(state는 그대로)', () => {
    const s = seed();
    const before = JSON.stringify(s);
    const im = deleteImpact(s, DOC)!;
    expect(im.title).toBe('비대면 출금동의 추진 현황 보고');
    expect(im.works).toBe(1);
    expect(im.stmts).toBeGreaterThan(0);
    expect(im.decisions).toBeGreaterThan(0);
    expect(im.actions).toBeGreaterThan(0);
    expect(im.events).toBeGreaterThan(0);
    expect(im.autoEvents).toBe(1);
    expect(im.relations).toBe(1);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('없는 문서는 null', () => expect(deleteImpact(seed(), 'D-NONE')).toBeNull());
});

describe('deleteDoc', () => {
  it('문서·관계·모든 인용을 지우고 참조가 남지 않는다. 입력 state는 바뀌지 않는다', () => {
    const s = seed();
    const before = JSON.stringify(s);
    const n = deleteDoc(s, DOC, 'U1', AT);
    expect(JSON.stringify(s)).toBe(before);
    expect(n.docs.some((d) => d.id === DOC)).toBe(false);
    expect(n.docs.some((d) => d.relations.some((r) => r.targetId === DOC))).toBe(false);
    expect(anyRef(n, DOC)).toEqual([]);
    expect(n.deletedDocs).toEqual([{ id: DOC, title: '비대면 출금동의 추진 현황 보고', writtenAt: s.docs.find((d) => d.id === DOC)!.writtenAt, at: AT }]);
    expect(checkIntegrity(n)).toEqual([]);
  });
  it('내용은 남고, 근거가 이 문서뿐이던 fact는 unverified + 삭제 메모', () => {
    const s = seed();
    const n = deleteDoc(s, DOC, 'U1', AT);
    expect(n.works.map((w) => w.current.length)).toEqual(s.works.map((w) => w.current.length));
    expect(n.decisions.length).toBe(s.decisions.length);
    expect(n.actions.length).toBe(s.actions.length);
    expect(n.events.length).toBe(s.events.length);
    const note = deletedNote('비대면 출금동의 추진 현황 보고');
    let changed = 0;
    for (const w of s.works)
      for (const f of ['purpose', 'background', 'current', 'cautions', 'rejected'] as const)
        for (const old of w[f]) {
          if (!citesDoc(old.cite) || old.cite!.some((c) => c.docId !== DOC)) continue;
          const now = n.works.find((x) => x.id === w.id)![f].find((x) => x.id === old.id)!;
          expect(now.text).toBe(old.text);
          expect(now.cite).toBeUndefined();
          expect(now.note).toContain(note);
          if (old.prov === 'fact') expect(now.prov).toBe('unverified');
          changed++;
        }
    expect(changed).toBeGreaterThan(0);
    for (const d of s.decisions.filter((x) => citesDoc(x.cite) && x.cite.length === 1)) {
      const now = n.decisions.find((x) => x.id === d.id)!;
      expect(now.cite).toEqual([]);
      expect(now.source).toBe('unverified');
      if (d.prov === 'fact') expect(now.prov).toBe('unverified');
      expect(now.title).toBe(d.title);
    }
  });
  it('다른 문서 근거가 남아 있으면 prov를 유지하고 그 인용만 뺀다', () => {
    const s = seed();
    const w = s.works.find((x) => x.id === 'W-001')!;
    const st = w.current.find((x) => citesDoc(x.cite))!;
    st.prov = 'fact';
    st.cite = [...st.cite!, { docId: 'D-6XBF8', label: '회의록' }];
    const n = deleteDoc(s, DOC, 'U1', AT);
    const now = n.works.find((x) => x.id === 'W-001')!.current.find((x) => x.id === st.id)!;
    expect(now.prov).toBe('fact');
    expect(now.cite).toEqual([{ docId: 'D-6XBF8', label: '회의록' }]);
    expect(now.note ?? '').not.toContain('원문 문서 삭제됨');
  });
  it('자동 타임라인 이벤트: 내용 유지, autoDocId·docIds 제거, 원문 상태 unverified, 의미에 메모', () => {
    const s = seed();
    const auto = s.events.find((e) => e.autoDocId === DOC)!;
    const n = deleteDoc(s, DOC, 'U1', AT);
    const now = n.events.find((e) => e.id === auto.id)!;
    expect(now.title).toBe(auto.title);
    expect(now.autoDocId).toBeUndefined();
    expect(now.docIds).not.toContain(DOC);
    expect(now.cite).toEqual([]);
    expect(now.source).toBe('unverified');
    expect(now.meaning).toContain('원문 문서 삭제됨');
  });
  it('연결된 업무마다 이력 1줄 + 업무 갱신(버전+1)', () => {
    const s = seed();
    const doc = s.docs.find((d) => d.id === DOC)!;
    const vBefore = s.works.find((w) => w.id === doc.workIds[0])!.version;
    const n = deleteDoc(s, DOC, 'U1', AT);
    const hs = n.history.filter((h) => h.kind === '문서 삭제');
    expect(hs).toHaveLength(doc.workIds.length);
    expect(hs[0].summary).toMatch(/^'비대면 출금동의 추진 현황 보고' 삭제 · 근거 낮춤 \d+건$/);
    expect(hs[0]).toMatchObject({ actorId: 'U1', at: AT });
    const w = n.works.find((x) => x.id === doc.workIds[0])!;
    expect(w.version).toBe(vBefore + 1);
    expect(w.updatedAt).toBe(AT);
  });
  it('스냅샷은 건드리지 않고, 옛 참조가 있어도 무결성 점검을 통과한다', () => {
    const s = seed();
    const w = s.works.find((x) => x.id === 'W-001')!;
    const dec = s.decisions.find((d) => citesDoc(d.cite))!;
    const snap: Snapshot = {
      id: 'SN-T1', handoverId: s.handovers[0].id, workId: w.id, takenAt: AT, version: w.version,
      work: clone(w), decisions: [clone(dec)], actions: [], events: s.events.filter((e) => e.autoDocId === DOC).map(clone),
      docs: [{ id: DOC, title: 't', type: '보고자료', writtenAt: '2026-01-01', availability: 'original' }],
    };
    expect(s.handovers.length).toBeGreaterThan(0);
    s.snapshots.push(snap);
    const n = deleteDoc(s, DOC, 'U1', AT);
    expect(n.snapshots).toEqual(s.snapshots);
    expect(checkIntegrity(n)).toEqual([]);
  });
  it('없는 문서는 그대로', () => {
    const s = seed();
    expect(deleteDoc(s, 'D-NONE', 'U1', AT)).toBe(s);
  });
  it('회의록을 지우면 회의록 목록(type=회의록 문서)에서 사라진다', () => {
    const s = seed();
    const m = s.docs.find((d) => d.type === '회의록')!;
    const n = deleteDoc(s, m.id, 'U1', AT);
    expect(n.docs.filter((d) => d.type === '회의록').some((d) => d.id === m.id)).toBe(false);
    expect(scopeFor(n, 'U1').docs.some((d) => d.id === m.id)).toBe(false);
  });
});

describe('canDeleteDoc — 새 권한 규칙 없이 canEdit 그대로', () => {
  it('올린 사람, 연결 업무를 고칠 수 있는 사람은 가능, 나머지는 불가', () => {
    const s = seed();
    const d = s.docs.find((x) => x.id === 'D-105')!; // 올린 U7, 업무 W-007
    expect(canDeleteDoc(s, d.id, 'U7')).toBe(true);
    const w = s.works.find((x) => x.id === 'W-007')!;
    const other = w.owners.find((o) => o !== 'U7');
    if (other) expect(canDeleteDoc(s, d.id, other)).toBe(true);
    expect(canDeleteDoc(s, d.id, 'U12')).toBe(false);
    expect(canDeleteDoc(s, 'D-NONE', 'U7')).toBe(false);
  });
});

describe('지운 문서 흔적(deletedDocs): 내보내기·불러오기', () => {
  it('내보내기·migrate·parseBackup을 통과한다', () => {
    const n = deleteDoc(seed(), DOC, 'U1', AT);
    const exp = exportBackupState(n);
    expect(exp.deletedDocs).toHaveLength(1);
    const text = JSON.stringify(exp);
    expect(parseBackup(text).deletedDocs).toEqual(n.deletedDocs);
    expect(migrate(JSON.parse(text)).deletedDocs).toEqual(n.deletedDocs);
  });
  it('같은 제목+작성일 문서는 합쳐 불러오기에서 되살아나지 않고 건너뜀 건수에 든다', () => {
    const colleague = seed(); // 지우기 전 백업을 가진 동료
    const mine = deleteDoc(seed(), DOC, 'U1', AT);
    const plan = planMerge(mine, colleague);
    expect(plan.skipped.deletedDocs).toBe(1);
    expect(skippedLine(plan.skipped)).toContain('삭제한 문서 1건');
    const { state } = applyMerge(mine, colleague);
    expect(state.docs.some((d) => d.id === DOC || d.title === '비대면 출금동의 추진 현황 보고')).toBe(false);
    expect(anyRef(state, DOC)).toEqual([]);
    expect(checkIntegrity(state)).toEqual([]);
    expect(state.deletedDocs).toHaveLength(1);
  });
  it('지운 적 없으면 건너뜀 칸이 없다(기존 모양 유지)', () => {
    const plan = planMerge(seed(), seed());
    expect(plan.skipped).toEqual({ privateMemos: 0, mapHidden: 0 });
  });
});
