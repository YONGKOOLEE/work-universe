// 표준 양식 점검(T-20, R-16, D-16). 업무 노드에 인수인계에 필요한 항목이 비어 있는지 알린다. 막지 않는다.
// 권장 항목은 조력자 의견(2026-10-12)과 사용자 결정("전부 추천으로 진행")으로 정했다: 절차·주기·마감·주의사항·관련 문서·담당(수행 연결)·설명.
// 이 모듈은 DOM·저장소를 쓰지 않는다. 데이터 틀(스키마)은 바꾸지 않고 속성 이름 약속만 쓴다(R-07).

import { parseGid } from '../view/view.js';
import { memoCategoryOf } from '../model/schema.js';
import { hasCautionMemo } from './handover.js';

/** 권장 항목 한 곳. 바꾸려면 여기만 고친다 */
export const STANDARD_FORM = {
  /** 업무 노드의 attrs에서 값을 찾는 권장 속성(이 순서로 알린다) */
  workAttrs: ['절차', '주기', '마감', '주의사항'],
  /** 관련 문서: 이 속성이 있거나, 업무에 이어진 산출물(산출·참조 연결)이 있으면 채운 것으로 본다 */
  relatedDocAttr: '관련 문서',
  /** 설명(description)도 권장 */
  description: '설명',
  /** 담당: 사람 → 업무 수행 연결이 한 번이라도 있으면 채운 것(지금 담당이 없는 것은 공백 인사이트가 다룬다) */
  performer: '담당',
  /** 한 유니버스의 노드(꼭지 제외)가 이 수를 넘으면 「나눠 보세요」를 안내한다. 02 5.6.2 쪼개는 단위(업무당 10~20개)에 여유를 둔 값. 바꾸려면 여기만 */
  splitAbove: 25,
};

const nonEmpty = (v) => v !== undefined && v !== null && String(v).trim() !== '';

const EDGE_INDEX = new WeakMap(); // 뷰 → {edges, length, bySource, byTarget}

/**
 * 연결 색인: 끝점 gid → 그 끝점에서 나가는/들어오는 연결(view.edges의 원래 순서, 숨김 포함).
 * 뷰는 읽기 전용이라 뷰마다 한 번만 만든다. 연결 배열이 바뀌었으면(같은 뷰 객체의 edges를 갈아 끼운 경우) 다시 만든다.
 * 규칙 모듈(양식·준비도)이 업무마다 view.edges 전체를 훑던 것을 이 색인으로 바꾼다(RV10C-4).
 * @returns {{bySource:Map<string,object[]>, byTarget:Map<string,object[]>}}
 */
export function edgeIndex(view) {
  const hit = EDGE_INDEX.get(view);
  if (hit && hit.edges === view.edges && hit.length === view.edges.length) return hit;
  const bySource = new Map();
  const byTarget = new Map();
  const add = (map, key, e) => {
    const list = map.get(key);
    if (list) list.push(e);
    else map.set(key, [e]);
  };
  for (const e of view.edges) {
    add(bySource, e.source, e);
    add(byTarget, e.target, e);
  }
  const ix = { edges: view.edges, length: view.edges.length, bySource, byTarget };
  EDGE_INDEX.set(view, ix);
  return ix;
}

/**
 * hasCautionMemo(handover.js)와 같은 판정을 연결·이력 색인으로 한다(RV10C-4). 원래 함수는 업무마다 연결·이력 전체를 훑어
 * 주의사항 속성이 빈 업무가 많을 때 업무 3000개에서 수 초가 걸렸다. 판정 규칙은 그대로다 — 범위(업무와 그 아래 포함 업무) → 관련 노드(범위 + 범위 업무의
 * 주제) → 범위 업무가 속한(합쳐진 쪽 포함) 유니버스의 메모 중 관련 노드를 가리키는 것 가운데 「주의사항」 범주가 있는가.
 * 색인이 없는 뷰는 원래 함수로 돌아간다. 어긋나지 않는지는 tests/rv10-perf.test.js가 무작위 문서로 옛 판과 비교한다.
 */
function cautionMemoFast(view, workGid) {
  const eventsByNode = view.index && view.index.eventsByNode;
  const start = view.getNode(workGid);
  if (!eventsByNode || !start || start.hidden) return hasCautionMemo(view, workGid);
  const { bySource } = edgeIndex(view);
  const works = start.core_type === 'work' ? [start] : [];
  const seen = new Set([start.gid]);
  const queue = [start.gid];
  while (queue.length) {
    const g = queue.shift();
    for (const e of bySource.get(g) || []) {
      if (e.hidden || e.core_type !== 'contains' || seen.has(e.target)) continue;
      const child = view.getNode(e.target);
      if (!child || child.hidden) continue;
      seen.add(child.gid);
      queue.push(child.gid);
      if (child.core_type === 'work') works.push(child);
    }
  }
  const related = new Set([start.gid, ...works.map((w) => w.gid)]);
  for (const w of works) for (const e of bySource.get(w.gid) || []) if (!e.hidden && e.core_type === 'relates_to') related.add(e.target);
  const universes = new Set([start, ...works].flatMap((n) => [n.universe_id, ...(n.merged_from || []).map((g) => parseGid(g).universe_id)]));
  for (const g of related) {
    for (const ev of eventsByNode.get(g) || []) {
      if (ev.type === 'memo' && universes.has(ev.universe_id) && memoCategoryOf(ev.payload) === 'caution') return true;
    }
  }
  return false;
}

/**
 * 업무 하나의 빈 권장 항목 이름 목록.
 * @param {object} view buildView 결과
 * @param {string} workGid
 * @returns {string[]|null} 업무가 아니거나 숨김이면 null. 다 채웠으면 빈 배열
 */
export function workFormMissing(view, workGid) {
  const work = view.getNode(view.canonical(workGid));
  if (!work || work.core_type !== 'work' || work.hidden) return null;
  const attrs = work.attrs || {};
  const missing = [];
  if (!nonEmpty(work.description)) missing.push(STANDARD_FORM.description);
  for (const k of STANDARD_FORM.workAttrs) {
    // 주의사항은 속성 말고 주의사항 범주 메모도 인정한다 — 인수인계 초안이 그 메모를 주의사항 근거로 쓰기 때문(D8-4)
    // (속성이 이미 차 있으면 메모를 볼 필요가 없다: 메모 판정은 업무마다 이력 전체를 훑어 느리다)
    if (nonEmpty(attrs[k])) continue;
    if (k === '주의사항' && cautionMemoFast(view, work.gid)) continue;
    missing.push(k);
  }

  // 이 업무에 닿는 연결만 본다(연결 색인은 뷰마다 한 번 만든다, RV10C-4)
  const ix = edgeIndex(view);
  const out = ix.bySource.get(work.gid) || [];
  const into = ix.byTarget.get(work.gid) || [];
  const isArtifact = (g) => { const n = view.getNode(g); return !!n && !n.hidden && n.core_type === 'artifact'; };
  const hasDoc = nonEmpty(attrs[STANDARD_FORM.relatedDocAttr])
    || out.some((e) => !e.hidden && (e.core_type === 'produces' || e.core_type === 'references') && isArtifact(e.target))
    || into.some((e) => !e.hidden && (e.core_type === 'produces' || e.core_type === 'references') && e.source !== work.gid && isArtifact(e.source));
  if (!hasDoc) missing.push(STANDARD_FORM.relatedDocAttr);

  const hasPerformer = into.some((e) => !e.hidden && e.core_type === 'performs' && view.getNode(e.source)?.core_type === 'person' && !view.getNode(e.source).hidden);
  if (!hasPerformer) missing.push(STANDARD_FORM.performer);
  return missing;
}

/**
 * 합성 뷰 전체의 표준 양식 점검(가져오기 미리 보기·제출 전 샘플 점검용).
 * @returns {{total:number, incomplete:number, works:{gid:string,label:string,universe_name?:string,missing:string[]}[]}}
 */
export function formReport(view) {
  const works = [];
  let total = 0;
  for (const n of view.nodes) {
    if (n.core_type !== 'work' || n.hidden) continue;
    total += 1;
    const missing = workFormMissing(view, n.gid);
    if (missing && missing.length) works.push({ gid: n.gid, label: n.label, universe_name: n.universe_name, missing });
  }
  return { total, incomplete: works.length, works };
}

/**
 * 큰 유니버스에 「업무별로 나누세요」 안내가 필요한지(조력자 의견 2026-10-17 "업무가 커지면 그림이 난잡해진다").
 * 이 유니버스 문서 자신의 숨기지 않은 노드(꼭지 제외)만 센다. 하위 유니버스 노드는 묶은 화면에서 이미 접혀 보이므로 세지 않는다.
 * @returns {{count:number, limit:number}|null}
 */
export function splitHint(doc) {
  const count = (doc.nodes || []).filter((n) => !n.hidden && n.core_type !== 'root').length;
  return count > STANDARD_FORM.splitAbove ? { count, limit: STANDARD_FORM.splitAbove } : null;
}
