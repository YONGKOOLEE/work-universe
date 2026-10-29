// 올린 문서 삭제 — 「삭제 + 반영 내용은 남김」 (사용자 결정 2026-10-29)
// 문서와 문서 사이의 관계, 그 문서를 근거로 든 모든 칸의 인용(cite)을 빼되 업무 문장·결정·조치·이벤트의 내용은 남긴다.
// 근거가 그 문서뿐이던 '원문 확인(fact)'은 '추가 확인 필요(unverified)'로 낮추고, 원문 상태(SourceStatus)도 원문 없음('unverified')으로 맞춘다.
// 인계 스냅샷은 과거 기록이므로 건드리지 않는다. 브라우저 기능을 쓰지 않는 순수 함수(Node 단위 테스트 가능).
import type { Action, AppState, Cite, DeletedDoc, Decision, Doc, Partner, SourceStatus, Stmt, TEvent } from './types';
import { uid } from './util';

/** 원문이 있다고 보는 상태 — 근거를 모두 잃으면 'unverified'(원문 근거 확인 안 됨)로 바꾼다. reference·record는 원래 원문 없는 상태라 그대로 둔다 */
const HAS_SOURCE: SourceStatus[] = ['original', 'cited', 'link'];

/** 비교용 문자열: NFC로 맞추고 공백을 모두 없애고 소문자로(공백·대소문자 차이를 무시) */
const normText = (s: string) => String(s ?? '').normalize('NFC').replace(/\s+/g, '').toLowerCase();

export const deletedNote = (title: string) => `원문 문서 삭제됨: ${title}`;

/** 삭제 영향 건수(확인 창용). 같은 항목을 두 번 세지 않는다 */
export interface DeleteImpact {
  title: string;
  /** 연결된 업무 수 */
  works: number;
  /** 이 문서를 근거로 든 업무 문장(목적·배경·현황·주의·제외) 수 */
  stmts: number;
  /** 협의처 수 */
  partners: number;
  decisions: number;
  actions: number;
  /** 타임라인 이벤트(문서 등록으로 자동 생긴 것 포함) 수 */
  events: number;
  /** 그 중 이 문서 등록으로 자동 생긴 이벤트 */
  autoEvents: number;
  /** 이 문서와 다른 문서 사이의 관계 수(이쪽→저쪽, 저쪽→이쪽 합) */
  relations: number;
  /** 근거가 이 문서뿐이라 '원문 확인' → '추가 확인 필요'로 낮아지는 항목 수 */
  downgraded: number;
  /** 근거가 없어지는 항목 수(낮춤 여부와 상관없이, 인용이 하나도 안 남는 것) */
  lostAll: number;
}

interface Result {
  impact: DeleteImpact;
  /** 업무별 낮춘 건수 */
  downgradedByWork: Map<string, number>;
  /** 인용이 바뀐 업무 ID */
  touchedWorks: Set<string>;
}

function appendNote(note: string | undefined, add: string): string {
  if (!note) return add;
  return note.includes(add) ? note : `${note} · ${add}`;
}

/**
 * draft에서 이 문서에 대한 모든 참조를 뺀다(draft를 직접 바꿈). 문서 자체와 스냅샷은 건드리지 않는다.
 * 합쳐 불러오기가 지운 문서의 옛 참조를 정리할 때도 쓴다.
 */
export function stripDocRefs(draft: AppState, docId: string, title: string): Result {
  const note = deletedNote(title);
  const impact: DeleteImpact = { title, works: 0, stmts: 0, partners: 0, decisions: 0, actions: 0, events: 0, autoEvents: 0, relations: 0, downgraded: 0, lostAll: 0 };
  const downgradedByWork = new Map<string, number>();
  const touchedWorks = new Set<string>();
  const hit = (cs: Cite[] | undefined) => !!cs?.some((c) => c.docId === docId);
  const drop = (cs: Cite[] | undefined): Cite[] => (cs ?? []).filter((c) => c.docId !== docId);
  const bump = (workIds: string[], n: number) => {
    for (const w of workIds) {
      touchedWorks.add(w);
      if (n) downgradedByWork.set(w, (downgradedByWork.get(w) ?? 0) + n);
    }
  };

  const stmt = (x: Stmt | Partner, workIds: string[], kind: 'stmts' | 'partners') => {
    if (!hit(x.cite)) return;
    const rest = drop(x.cite);
    impact[kind]++;
    let down = 0;
    if (rest.length) x.cite = rest;
    else {
      delete x.cite;
      impact.lostAll++;
      if (x.prov === 'fact') {
        x.prov = 'unverified';
        down = 1;
        impact.downgraded++;
      }
      x.note = appendNote(x.note, note);
    }
    bump(workIds, down);
  };

  for (const w of draft.works) {
    for (const f of ['purpose', 'background', 'current', 'cautions', 'rejected'] as const) for (const x of w[f]) stmt(x, [w.id], 'stmts');
    for (const p of w.partners) stmt(p, [w.id], 'partners');
  }

  const decision = (d: Decision) => {
    const inCite = hit(d.cite);
    const inRat = hit(d.rationale.cite);
    if (!inCite && !inRat) return;
    impact.decisions++;
    let down = 0;
    if (inCite) {
      d.cite = drop(d.cite);
      if (!d.cite.length) {
        impact.lostAll++;
        if (d.prov === 'fact') {
          d.prov = 'unverified';
          down++;
          impact.downgraded++;
        }
        if (HAS_SOURCE.includes(d.source)) d.source = 'unverified';
        if (!d.details.includes(note)) d.details = [...d.details, note];
      }
    }
    if (inRat) {
      const r = d.rationale;
      const rest = drop(r.cite);
      if (rest.length) r.cite = rest;
      else {
        delete r.cite;
        if (r.prov === 'fact') {
          r.prov = 'unverified';
          down++;
          impact.downgraded++;
        }
        r.note = appendNote(r.note, note);
      }
    }
    bump([d.workId], down);
  };
  draft.decisions.forEach(decision);

  const action = (a: Action) => {
    if (!hit(a.cite)) return;
    impact.actions++;
    const rest = drop(a.cite);
    if (rest.length) a.cite = rest;
    else {
      delete a.cite;
      impact.lostAll++;
      a.note = appendNote(a.note, note);
    }
    bump([a.workId], 0);
  };
  draft.actions.forEach(action);

  const event = (e: TEvent) => {
    const inCite = hit(e.cite);
    const inIds = e.docIds.includes(docId);
    const inAuto = e.autoDocId === docId;
    const inCause = e.causes.some((c) => hit(c.cite));
    if (!inCite && !inIds && !inAuto && !inCause) return;
    impact.events++;
    if (inAuto) impact.autoEvents++;
    let down = 0;
    if (inCite) e.cite = drop(e.cite);
    if (inIds) e.docIds = e.docIds.filter((x) => x !== docId);
    if (inAuto) delete e.autoDocId;
    if ((inCite || inIds || inAuto) && !e.cite.length && !e.docIds.length) {
      impact.lostAll++;
      // 원문 상태: 근거가 모두 사라진 이벤트는 '원문 근거 확인 안 됨'(unverified). 정책 이력 참고·플랫폼 기록은 원래 원문이 없으므로 그대로
      if (HAS_SOURCE.includes(e.source)) {
        e.source = 'unverified';
        down++;
        impact.downgraded++;
      }
      e.meaning = appendNote(e.meaning, note);
    }
    for (const c of e.causes) {
      if (!hit(c.cite)) continue;
      const rest = drop(c.cite);
      if (rest.length) c.cite = rest;
      else {
        delete c.cite;
        if (c.basis === 'fact') {
          c.basis = 'inference'; // CauseLink에는 '추가 확인' 값이 없어 한 단계 낮춘다
          down++;
          impact.downgraded++;
        }
        c.note = appendNote(c.note, note);
      }
    }
    bump(e.workIds, down);
  };
  draft.events.forEach(event);

  // 문서 사이의 관계: 이 문서가 가리키는 것(문서와 함께 사라짐) + 다른 문서가 이 문서를 가리키는 것
  const self = draft.docs.find((d) => d.id === docId);
  impact.relations += self?.relations.length ?? 0;
  for (const d of draft.docs) {
    if (d.id === docId) continue;
    const n = d.relations.filter((r) => r.targetId === docId).length;
    if (n) {
      impact.relations += n;
      d.relations = d.relations.filter((r) => r.targetId !== docId);
    }
  }
  impact.works = self?.workIds.length ?? 0;
  return { impact, downgradedByWork, touchedWorks };
}

/** 삭제 전에 영향 건수를 센다(state는 바뀌지 않음). 문서가 없으면 null */
export function deleteImpact(state: AppState, docId: string): DeleteImpact | null {
  const d = state.docs.find((x) => x.id === docId);
  if (!d) return null;
  const copy = JSON.parse(JSON.stringify(state)) as AppState;
  return stripDocRefs(copy, docId, d.title).impact;
}

/** 이 문서를 지우면 내용이 바뀌는 모든 업무 ID: 연결된 업무 + 이 문서를 인용한 업무(deleteDoc이 이력·버전을 올리는 업무 집합과 같다). state는 바뀌지 않음 */
export function affectedWorkIds(state: AppState, docId: string): string[] {
  const d = state.docs.find((x) => x.id === docId);
  if (!d) return [];
  const copy = JSON.parse(JSON.stringify(state)) as AppState;
  const { touchedWorks } = stripDocRefs(copy, docId, d.title);
  return [...new Set([...d.workIds, ...touchedWorks])].filter((w) => state.works.some((x) => x.id === w));
}

/** 문서를 지우고 새 state를 돌려준다. 없는 문서면 그대로 돌려준다 */
export function deleteDoc(state: AppState, docId: string, actorId: string, nowIso: string): AppState {
  const doc = state.docs.find((x) => x.id === docId);
  if (!doc) return state;
  const s = JSON.parse(JSON.stringify(state)) as AppState;
  const { downgradedByWork, touchedWorks } = stripDocRefs(s, docId, doc.title);
  s.docs = s.docs.filter((x) => x.id !== docId);
  const tomb: DeletedDoc = { id: doc.id, title: doc.title, writtenAt: doc.writtenAt, at: nowIso };
  s.deletedDocs = [...(s.deletedDocs ?? []).filter((t) => t.id !== doc.id), tomb];
  // 연결된 업무마다 이력 1줄 + 업무 갱신(store의 log/touch와 같은 효과)
  for (const wid of new Set([...doc.workIds, ...touchedWorks])) {
    const w = s.works.find((x) => x.id === wid);
    if (!w) continue;
    const n = downgradedByWork.get(wid) ?? 0;
    s.history.push({ id: uid('H'), workId: wid, at: nowIso, actorId, kind: '문서 삭제', summary: `'${doc.title}' 삭제 · 근거 낮춤 ${n}건` });
    w.updatedAt = nowIso;
    w.version += 1;
  }
  return s;
}

/** 합쳐 불러오기에서 지운 문서를 알아보는 열쇠: 제목(공백·부호 무시) + 작성일 */
export const docTombKey = (d: Pick<Doc, 'title' | 'writtenAt'>) => `${normText(d.title)}|${d.writtenAt}`;

/** 이 문서(제목+작성일)가 지운 문서 목록에 있으면 그 흔적 */
export function findTomb(deleted: DeletedDoc[] | undefined, d: Pick<Doc, 'title' | 'writtenAt'>): DeletedDoc | undefined {
  const k = docTombKey(d);
  return (deleted ?? []).find((t) => docTombKey(t) === k);
}

/** 문서를 새로 등록할 때 같은 열쇠(제목+작성일)의 삭제 기록을 지운다(draft를 직접 바꿈). 다시 올린 문서의 인용이 합쳐 불러오기에서 삭제 처리되지 않게 한다.
 *  단, 인계 스냅샷이 그 옛 문서 ID를 아직 가리키면 그 기록은 남긴다(참조 무결성 점검이 옛 ID를 알아보는 데 쓰므로). 그 경우는 합쳐 불러오기의 「지금 문서와 같은지 먼저」 대조가 막는다 */
export function forgetTombFor(d: Pick<AppState, 'deletedDocs' | 'snapshots'>, doc: Pick<Doc, 'title' | 'writtenAt'>): void {
  if (!d.deletedDocs) return;
  const k = docTombKey(doc);
  const snap = JSON.stringify(d.snapshots ?? []);
  const rest = d.deletedDocs.filter((t) => docTombKey(t) !== k || snap.includes(`"${t.id}"`));
  d.deletedDocs = rest.length ? rest : undefined;
}
