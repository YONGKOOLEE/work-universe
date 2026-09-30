// 명령 흐름 조립과 현재 상태(12.7 app). 화면은 이 객체만 호출한다.

import { addNode } from '../model/commands.js';
import { CODES } from '../model/schema.js';

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
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
    if (!doc) {
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
