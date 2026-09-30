// 명령 흐름 조립과 현재 상태(12.7 app). 화면은 이 객체만 호출한다.

import { addNode } from '../model/commands.js';
import { CODES } from '../model/schema.js';

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

// 저장된 샘플이 내장 샘플의 이전 판이면 true. 판은 universe.created_at으로 구분한다(app/data/sample-*.js 머리말).
// 사용자가 고친 샘플(source가 user인 이벤트가 있음)이라도 판이 다르면 새 샘플로 바꾼다. 원래 값은 "가상 데이터 초기화"로 되돌리는 것과 같다.
function isStaleSample(stored, sample) {
  return !!stored.universe.is_sample && stored.universe.created_at !== sample.universe.created_at;
}

/**
 * @param {{store: object|null, sample: object, now: ()=>string}} deps
 *   store가 null이면 저장소를 쓸 수 없는 상태다(W-STORAGE → 샘플 읽기 전용, 5.3).
 */
export function createApp({ store, sample, now }) {
  const warnings = [];
  let doc;

  if (store) {
    doc = store.loadUniverse(sample.universe.id);
    if (!doc || isStaleSample(doc, sample)) {
      doc = clone(sample);
      store.saveUniverse(doc);
    }
  } else {
    doc = clone(sample);
    warnings.push({ code: CODES.STORAGE });
  }

  return {
    get doc() {
      return doc;
    },
    readOnly: !store,
    warnings,

    addNode(input) {
      if (!store) return { ok: false, error: { code: CODES.STORAGE } };
      const result = addNode(doc, input, { now: now() });
      if (!result.ok) return result;
      store.saveUniverse(result.doc);
      doc = result.doc;
      return result;
    },

    // 가상 데이터 초기화(6절 복구): 내장 샘플로 되돌린다.
    resetToSample() {
      if (!store) return;
      doc = clone(sample);
      store.saveUniverse(doc);
    },
  };
}
