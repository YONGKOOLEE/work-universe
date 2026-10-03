// 가져오기 미리 보기(T-17, 12.9 흐름: 검증 → 미리 보기 → 사람이 "가져오기"). 순수 함수.
// JSON 파일(내보낸 유니버스, 개발 중 변환한 문서 — CR-3 A)과 문서 초벌 변환 결과(CR-5 ②)를 같은 검사로 본다.

import { CODES, NODE_TYPES, nodeTypeLabel, normalizeLabel } from './schema.js';
import { validateDocument } from './validate.js';

export const IMPORT_MAX_CHARS = 5000000; // 가져올 JSON 글자 수 상한(브라우저 저장소 용량보다 작게)

/**
 * JSON 글을 유니버스 문서로 읽는다.
 * @returns {{ok:true, doc:object} | {ok:false, error:{code:string, reason:'empty'|'too_big'|'json'|'shape'}}}
 */
export function parseImportText(text) {
  const src = typeof text === 'string' ? text.replace(/^﻿/, '') : '';
  if (!src.trim()) return { ok: false, error: { code: CODES.REQUIRED, reason: 'empty' } };
  if (src.length > IMPORT_MAX_CHARS) return { ok: false, error: { code: CODES.SCHEMA, reason: 'too_big', max: IMPORT_MAX_CHARS } };
  let doc;
  try {
    doc = JSON.parse(src);
  } catch {
    return { ok: false, error: { code: CODES.SCHEMA, reason: 'json' } };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { ok: false, error: { code: CODES.SCHEMA, reason: 'shape' } };
  return { ok: true, doc };
}

const markOf = (n) => (n.attrs && typeof n.attrs.상태 === 'string' ? n.attrs.상태 : null);

/**
 * 가져오기 전에 보여 줄 내용과 막을 이유.
 * @param {object} doc 12.2 유니버스 문서
 * @param {{existing?: {id:string, name:string, level?:string, is_sample:boolean}[]}} ctx 이미 있는 유니버스
 * @returns {{ok:boolean, errors:object[], warnings:object[], version_mismatch:boolean, conflict:object|null,
 *   counts:{type:string, label:string, count:number}[], node_total:number, edge_total:number, memo_total:number,
 *   source:{with:number, total:number, missing:string[]}|null, marks:{가정:number, 미확인:number}, missing_children:string[]}}
 *   ok가 false면 가져오지 않는다(오류가 있거나 버전이 다름)
 */
export function previewImport(doc, { existing = [] } = {}) {
  const checked = validateDocument(doc);
  const base = { ok: false, errors: checked.errors, warnings: checked.warnings, version_mismatch: checked.readOnly, conflict: null, counts: [], node_total: 0, edge_total: 0, memo_total: 0, source: null, marks: { 가정: 0, 미확인: 0 }, missing_children: [] };
  if (checked.readOnly || !doc || !Array.isArray(doc.nodes)) return base;

  const nodes = doc.nodes.filter((n) => n && !n.hidden);
  const byType = new Map();
  for (const n of nodes) byType.set(n.core_type, (byType.get(n.core_type) || 0) + 1);
  const order = Object.keys(NODE_TYPES);
  const counts = [...byType].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([type, count]) => ({ type, label: nodeTypeLabel(type), count }));

  // 원문 근거(12.9): 문서 변환 결과이거나 근거를 단 노드가 하나라도 있으면 모든 노드를 본다
  const converted = Array.isArray(doc.universe.tags) && doc.universe.tags.includes('문서 변환');
  const withSource = nodes.filter((n) => n.attrs && typeof n.attrs.원문 === 'string' && n.attrs.원문.trim());
  const source = converted || withSource.length ? { with: withSource.length, total: nodes.length, missing: nodes.filter((n) => !withSource.includes(n)).map((n) => n.id) } : null;
  const warnings = [...checked.warnings];
  if (source && source.missing.length) warnings.push({ code: 'W-NO-SOURCE', count: source.missing.length, ids: source.missing });

  const marks = { 가정: 0, 미확인: 0 };
  for (const n of nodes) if (markOf(n) in marks) marks[markOf(n)] += 1;

  const ids = new Set(existing.map((u) => u.id));
  const missingChildren = (doc.refs || []).filter((r) => r && !r.hidden && !ids.has(r.child_universe_id) && r.child_universe_id !== doc.universe.id).map((r) => r.child_universe_id);
  if (missingChildren.length) warnings.push({ code: 'W-MISSING-CHILD', ids: missingChildren });

  const conflict = existing.find((u) => u.id === doc.universe.id) || null;
  // 같은 문서를 두 번 변환하면 ID는 달라도 이름·단위가 같다(N-2). 막지 않고 알린다(1.2: 사용자가 정한다)
  const sameName = conflict ? null : existing.find((u) => u.id !== doc.universe.id && typeof doc.universe.name === 'string' &&
    normalizeLabel(u.name) === normalizeLabel(doc.universe.name) && normalizeLabel(u.level || '') === normalizeLabel(doc.universe.level || '')) || null;
  if (sameName) warnings.push({ code: 'W-SAME-NAME', id: sameName.id, name: sameName.name, level: sameName.level });
  return {
    ...base,
    ok: checked.ok,
    warnings,
    conflict,
    same_name: sameName,
    counts,
    node_total: nodes.length,
    edge_total: doc.edges.filter((e) => e && !e.hidden).length,
    memo_total: doc.events.filter((e) => e && e.type === 'memo').length,
    source,
    marks,
    missing_children: missingChildren,
  };
}
