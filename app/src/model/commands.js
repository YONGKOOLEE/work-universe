// 명령 적용(순수 함수). 입력 문서를 바꾸지 않고 새 문서와 이벤트를 돌려준다(12.7 model).
// T-01 범위: 노드 추가만. 수정·숨김·연결·나머지 검증은 T-03에서 확장한다.

import { CODES, ID_PREFIX, LABEL_MAX, NODE_TYPES, normalizeLabel } from './schema.js';

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 12.1: 접두어 + 무작위 영숫자 8자리. random은 [0,1) 값을 돌려주는 함수(테스트에서 주입).
export function newId(prefix, random = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
  return prefix + s;
}

function uniqueId(prefix, taken, random) {
  let id;
  do id = newId(prefix, random); while (taken.has(id));
  return id;
}

/**
 * 노드 1개를 추가한다.
 * @param {object} doc 12.2 유니버스 문서
 * @param {{core_type:string, label:string, subtype?:string, description?:string, emp_no?:string}} input
 * @param {{now:string, random?:()=>number}} ctx now는 ISO 8601 날짜·시각(시간대 포함)
 * @returns {{ok:true, doc:object, node:object, event:object, warnings:object[]}
 *          | {ok:false, error:{code:string, field?:string, existing_id?:string}}}
 */
export function addNode(doc, input, ctx) {
  const coreType = input.core_type;
  const label = typeof input.label === 'string' ? input.label.trim() : '';

  if (!coreType) return { ok: false, error: { code: CODES.REQUIRED, field: 'core_type' } };
  if (!label) return { ok: false, error: { code: CODES.REQUIRED, field: 'label' } };
  if (label.length > LABEL_MAX) return { ok: false, error: { code: CODES.REQUIRED, field: 'label' } };
  // 꼭지는 유니버스 생성 때 자동으로만 생긴다(1.2 Root)
  if (!NODE_TYPES[coreType] || coreType === 'root') {
    return { ok: false, error: { code: CODES.SCHEMA, field: 'core_type' } };
  }

  const subtype = input.subtype || undefined;
  if (subtype) {
    const known = (doc.universe.subtypes || []).some((s) => s.core_type === coreType && s.name === subtype);
    if (!known) return { ok: false, error: { code: CODES.SUBTYPE, field: 'subtype' } };
  }

  const empNo = coreType === 'person' && input.emp_no ? String(input.emp_no).trim() : undefined;

  // 1.5 중복 판정: 사람은 같은 사번, 그 외는 같은 유형 + 같은 정규화 라벨
  const existing = doc.nodes.find((n) => {
    if (coreType === 'person' && empNo) return n.core_type === 'person' && n.emp_no === empNo;
    if (coreType === 'person') return false;
    return n.core_type === coreType && normalizeLabel(n.label) === normalizeLabel(label);
  });
  if (existing) return { ok: false, error: { code: CODES.DUP, existing_id: existing.id } };

  const random = ctx.random || Math.random;
  const node = {
    id: uniqueId(ID_PREFIX.node, new Set(doc.nodes.map((n) => n.id)), random),
    core_type: coreType,
    label,
    hidden: false,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  if (subtype) node.subtype = subtype;
  if (input.description) node.description = input.description;
  if (empNo) node.emp_no = empNo;

  const event = {
    id: uniqueId(ID_PREFIX.event, new Set(doc.events.map((e) => e.id)), random),
    type: 'created',
    occurred_at: ctx.now.slice(0, 10),
    recorded_at: ctx.now,
    source: 'user',
    payload: { target_kind: 'node', target_id: node.id },
  };

  const warnings = coreType === 'person' && !empNo ? [{ code: CODES.NO_EMPNO, target_id: node.id }] : [];

  return {
    ok: true,
    doc: { ...doc, nodes: [...doc.nodes, node], events: [...doc.events, event] },
    node,
    event,
    warnings,
  };
}
