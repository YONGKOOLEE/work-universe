// 명령 흐름 조립과 현재 상태(12.7 app). 화면은 이 객체만 호출한다.

import {
  addEdge, addEvent, addNode, addRef, addSubtype, createUniverse, decideIdentity, hideEdge, hideNode, hideRef, updateEdge, updateNode,
} from '../model/commands.js';
import { CODES, DRAFT_TARGET_TYPES, SUBTYPE_HANDOVER_DOC, TEXT_MAX, normalizeLabel } from '../model/schema.js';
import { validateDocument } from '../model/validate.js';
import { subtypeRegistered } from '../model/checks.js';
import { buildView, refGid, toGid } from '../view/view.js';

// 확정한 인수인계서에 남기는 초안 생성 방식의 표시 이름(llm/connector.js METHOD_LABELS의 짧은 꼴)
const METHOD_NAMES = { rule: '규칙 기반', pregen: '사전 생성', llm: 'LLM' };
import { scopeWorks } from '../rules/handover.js';
import { mergePlan } from '../merge/merge.js';
import { previewImport } from '../model/import.js';

// 사번 자동 연결(R-11 ①)을 문서에 적용한다. 판정자는 없다(emp_no_auto)
function applyAuto(doc, resolve, ctx) {
  const plan = mergePlan(buildView(doc, resolve), doc.identity_links || []);
  let next = doc;
  for (const a of plan.auto) {
    const r = decideIdentity(next, { a: a.a, b: a.b, kind: 'person', method: 'emp_no_auto', status: 'confirmed', reason: a.reason }, ctx);
    if (r.ok) next = r.doc;
  }
  return { doc: next, count: plan.auto.length };
}

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

// 저장된 샘플이 내장 샘플의 이전 판이면 true. 판은 universe.created_at으로 구분한다(app/data/sample-*.js 머리말).
// 사용자가 고친 샘플(source가 user인 이벤트가 있음)이라도 판이 다르면 새 샘플로 바꾼다. 원래 값은 "가상 데이터 초기화"로 되돌리는 것과 같다.
function isStaleSample(stored, sample) {
  return !!stored.universe.is_sample && stored.universe.created_at !== sample.universe.created_at;
}

// 저장소를 쓸 수 없을 때 쓰는 메모리 저장소. 새로고침하면 사라진다
function memoryStore() {
  const docs = new Map();
  return {
    loadUniverse: (id) => (docs.has(id) ? docs.get(id) : null),
    saveUniverse: (doc) => docs.set(doc.universe.id, doc),
    removeUniverse: (id) => docs.delete(id),
    listUniverses: () => [...docs.values()].map((d) => ({ id: d.universe.id, name: d.universe.name })),
  };
}

// 저장 실패가 용량 초과인지(브라우저마다 이름·코드가 다르다: Chrome·Edge QuotaExceededError/22, 구형 Firefox NS_ERROR_DOM_QUOTA_REACHED/1014)
export function storageFailReason(err) {
  if (!err) return 'write';
  return err.code === 22 || err.code === 1014 || /quota/i.test(String(err.name || '')) ? 'quota' : 'write';
}

/**
 * @param {{store: object|null, samples: object[], currentId?: string, now: ()=>string}} deps
 *   store가 null이면 저장소를 쓸 수 없는 상태다(W-STORAGE → 샘플 읽기 전용, 5.3).
 *   currentId가 없거나 찾을 수 없으면 첫 샘플을 연다.
 */
export function createApp({ store, samples, currentId, now }) {
  const warnings = [];
  let db = store || memoryStore();
  let writable = !!store; // 저장소에 쓸 수 있는가. 샘플 설치가 실패하면 false(읽기 전용)
  if (!store) warnings.push({ code: CODES.STORAGE });

  // 모든 내장 샘플을 저장소에 넣어 둔다. 상위 유니버스가 하위 유니버스를 찾을 수 있어야 한다(참조).
  // 판이 바뀐 샘플을 사용자가 고쳐 두었다면, 고친 내용이 사라진다는 것을 알린다.
  // 목록(index)이 깨져 샘플이 빠졌으면 다시 등록한다
  // 설치 중 저장이 실패하면(용량 부족 등) 빈 화면이 되지 않도록 메모리 저장소의 샘플을 읽기 전용으로 연다
  try {
    const listed = new Set(db.listUniverses().map((e) => e.id));
    for (const sample of samples) {
      const stored = db.loadUniverse(sample.universe.id);
      if (!stored || isStaleSample(stored, sample)) {
        if (stored && stored.events.some((e) => e.source === 'user')) {
          warnings.push({ code: CODES.SAMPLE_RESET, name: sample.universe.name });
        }
        db.saveUniverse(clone(sample));
      } else if (!listed.has(sample.universe.id)) {
        db.saveUniverse(stored);
      }
    }
  } catch (err) {
    const persisted = db;
    db = memoryStore();
    for (const sample of samples) db.saveUniverse(persisted.loadUniverse(sample.universe.id) || clone(sample));
    writable = false;
    warnings.push({ code: CODES.STORAGE, reason: 'install', quota: storageFailReason(err) === 'quota' });
  }

  let doc = (currentId && db.loadUniverse(currentId)) || db.loadUniverse(samples[0].universe.id);

  // 여는 문서를 검증한다(12.1·12.5). 스키마 버전이 다르면 경고하고 읽기 전용으로 연다. 그 밖의 오류는 알리기만 한다
  const checked = validateDocument(doc);
  const docReadOnly = checked.readOnly;
  if (docReadOnly) warnings.push({ code: CODES.SCHEMA, reason: 'version', found: doc.schema_version });
  else if (!checked.ok) warnings.push({ code: CODES.SCHEMA, reason: 'invalid', count: checked.errors.length });
  const readOnly = !writable || docReadOnly;
  const resolve = (id) => (id === doc.universe.id ? doc : db.loadUniverse(id));

  // 저장(브라우저 저장소 용량 초과 등)이 실패하면 화면 상태를 바꾸지 않고 W-STORAGE로 알린다.
  // 저장된 것과 화면이 어긋나지 않게 하기 위해서다
  function save(d) {
    try {
      db.saveUniverse(d);
      return null;
    } catch (err) {
      return { ok: false, error: { code: CODES.STORAGE, reason: storageFailReason(err) } };
    }
  }
  function commit(result) {
    if (!result.ok) return result;
    const failed = save(result.doc);
    if (failed) return failed;
    doc = result.doc;
    return result;
  }
  const importCtx = (existing) => ({ existing, resolve: (id) => db.loadUniverse(id), sampleIds: samples.map((s) => s.universe.id) });
  const guard = () => (!writable ? { ok: false, error: { code: CODES.STORAGE } } : docReadOnly ? { ok: false, error: { code: CODES.SCHEMA, reason: 'version' } } : null);

  return {
    get doc() {
      return doc;
    },
    // 화면과 규칙이 쓰는 합성 뷰(12.7). 현재 문서가 바뀔 때마다 새로 계산한다
    get view() {
      return buildView(doc, resolve);
    },
    readOnly,
    // 저장소 자체를 쓸 수 있는지(읽기 전용이어도 초기화로 복구할 수 있는 경우를 가르기 위해)
    canReset: !!store,
    warnings,

    // 현재 문서 조회(검토5 C-8): 화면이 doc 내부 배열을 직접 뒤지지 않게 한다
    /** 현재 유니버스의 노드(문서 안 ID). 없으면 undefined */
    findNode(id) {
      return doc.nodes.find((n) => n.id === id);
    },
    /** 현재 유니버스의 연결(문서 안 ID). 없으면 undefined */
    findEdge(id) {
      return doc.edges.find((e) => e.id === id);
    },
    /** 현재 유니버스에 등록된 하위 유형 [{core_type, name}]. 없으면 빈 배열 */
    subtypes() {
      return doc.universe.subtypes || [];
    },
    /** 그 유니버스를 하위 유니버스로 묶고 있는가(숨긴 참조 제외) */
    hasChild(universeId) {
      return (doc.refs || []).some((r) => r.child_universe_id === universeId && !r.hidden);
    },
    /** 현재 유니버스 꼭지의 전역 참조 */
    rootGid() {
      return toGid(doc.universe.id, doc.universe.root_node_id);
    },

    /** 고를 수 있는 유니버스 목록(샘플 + 사용자가 만든 것) */
    universes() {
      return db
        .listUniverses()
        .map((e) => db.loadUniverse(e.id))
        .filter(Boolean)
        .map((d) => ({
          id: d.universe.id,
          name: d.universe.name,
          level: d.universe.level,
          owner: d.universe.owner,
          description: d.universe.description || '',
          node_count: d.nodes.filter((n) => !n.hidden).length,
          ref_count: (d.refs || []).filter((r) => !r.hidden).length,
          is_sample: !!d.universe.is_sample,
        }));
    },

    /** 주어진 유니버스를 묶은(참조하는) 상위 유니버스 목록 [{id, name}]. 「위층에 드러내기」를 보일지 정할 때 쓴다(검토5 U-4) */
    parentsOf(universeId) {
      return db
        .listUniverses()
        .map((e) => db.loadUniverse(e.id))
        .filter((d) => d && (d.refs || []).some((r) => r.child_universe_id === universeId && !r.hidden))
        .map((d) => ({ id: d.universe.id, name: d.universe.name }));
    },

    // 자료 편집(R-02, T-06): 현재 유니버스 문서만 고친다. 다른 유니버스 노드는 그 유니버스를 열어서 고친다
    addNode(input) {
      return guard() || commit(addNode(doc, input, { now: now() }));
    },
    hideNode(nodeId) {
      return guard() || commit(hideNode(doc, nodeId, { now: now() }));
    },
    addEdge(input) {
      return guard() || commit(addEdge(doc, input, { now: now() }));
    },
    updateEdge(edgeId, changes) {
      return guard() || commit(updateEdge(doc, edgeId, changes, { now: now() }));
    },
    hideEdge(edgeId) {
      return guard() || commit(hideEdge(doc, edgeId, { now: now() }));
    },
    addEvent(input) {
      return guard() || commit(addEvent(doc, input, { now: now() }));
    },

    // 노드 수정. 다른 유니버스의 노드면 그 유니버스 문서를 고친다(예: 위로 드러내기)
    updateNode(universeId, nodeId, changes) {
      if (guard()) return guard();
      if (universeId === doc.universe.id) return commit(updateNode(doc, nodeId, changes, { now: now() }));
      const other = db.loadUniverse(universeId);
      if (!other) return { ok: false, error: { code: CODES.SCHEMA, field: 'universe_id' } };
      const result = updateNode(other, nodeId, changes, { now: now() });
      if (result.ok) {
        const failed = save(result.doc);
        if (failed) return failed;
      }
      return result;
    },

    /**
     * 여러 유니버스를 묶어 상위 유니버스를 만든다(R-11 ①, CR-4 시제품).
     * 사용자가 하위 유니버스와 이름·단위를 고른다. 원본은 바꾸지 않는다.
     */
    groupUniverses({ name, level, owner, childIds }) {
      if (guard()) return guard();
      if (!childIds || childIds.length < 2) return { ok: false, error: { code: CODES.REQUIRED, field: 'child_universe_ids' } };
      const created = createUniverse({ name, level, owner }, { now: now() });
      if (!created.ok) return created;
      let next = created.doc;
      for (const id of childIds) {
        const r = addRef(next, id, { now: now() }, (x) => db.loadUniverse(x));
        if (!r.ok) return { ...r, child_id: id };
        next = r.doc;
      }
      // 같은 사번·이름의 사람은 묶을 때 바로 하나로 잇는다(R-11 ①). 나머지는 확인 목록(merge.mergePlan)
      const autoApplied = applyAuto(next, (x) => (x === next.universe.id ? next : db.loadUniverse(x)), { now: now() });
      next = autoApplied.doc;
      const failedGroup = save(next);
      if (failedGroup) return failedGroup;
      return { ok: true, doc: next, auto_linked: autoApplied.count };
    },

    // 같은 이름·단위의 유니버스가 이미 있는지(1.2: 경고하고 사용자가 정한다)
    findSameUniverse(name, level) {
      return this.universes().find((u) => normalizeLabel(u.name) === normalizeLabel(name || '') && normalizeLabel(u.level) === normalizeLabel(level || '')) || null;
    },

    /** 빈 유니버스를 만든다(R-12). 이름·단위·작성 주체가 필수다. 꼭지와 생성 이벤트가 자동으로 생긴다 */
    createUniverse(input) {
      if (guard()) return guard();
      const created = createUniverse(input, { now: now() });
      if (!created.ok) return created;
      const failedCreate = save(created.doc);
      if (failedCreate) return failedCreate;
      return created;
    },

    /** 현재 유니버스에 하위 유형을 등록한다(1.3 ②). 데이터만 늘고 코드 변경은 없다 */
    addSubtype(coreType, name) {
      return guard() || commit(addSubtype(doc, { core_type: coreType, name }));
    },

    /** 통합 확인 목록(R-11 ②③): 하위 유니버스를 참조한 유니버스에서만 의미가 있다 */
    mergePlan() {
      if (!(doc.refs || []).some((r) => !r.hidden)) return null;
      return mergePlan(buildView(doc, resolve), doc.identity_links || []);
    },

    /** 사번 자동 연결 대상이 남아 있으면 적용한다(예: 묶은 뒤 하위 유니버스에 사람이 늘었을 때) */
    applyAutoLinks() {
      if (guard()) return guard();
      const r = applyAuto(doc, resolve, { now: now() });
      if (!r.count) return { ok: true, doc, count: 0 };
      const failed = save(r.doc);
      if (failed) return failed;
      doc = r.doc;
      return { ok: true, doc, count: r.count };
    },

    /** 사람의 판정(같음 confirmed / 다름 rejected)을 기록한다(R-11 ②③, 12.7 흐름 3 ⑤). 원래 유니버스는 바뀌지 않는다(R-11 ⑤) */
    decideIdentity({ a, b, kind, status, reason, score }) {
      return guard() || commit(decideIdentity(doc, { a, b, kind, method: 'human', status, reason, score, decided_by: '사용자(이 브라우저)' }, { now: now() }));
    },

    /** 가져오기 미리 보기(T-17): 검증 결과·구성·같은 ID 유니버스 */
    previewImport(d) {
      return previewImport(d, importCtx(this.universes()));
    },

    /**
     * 사람이 미리 보기를 확인하고 「가져오기」를 눌렀을 때만 저장한다(CR-3 AC ③).
     * 검증을 통과하지 못하면 저장하지 않는다(AC ①). 같은 ID가 있으면 overwrite가 true일 때만 덮어쓴다
     */
    importUniverse(d, { overwrite = false } = {}) {
      if (guard()) return guard();
      const p = previewImport(d, importCtx(this.universes()));
      if (p.version_mismatch) return { ok: false, error: { code: CODES.SCHEMA, reason: 'version', found: d && d.schema_version } };
      if (!p.ok) return { ok: false, error: { code: CODES.SCHEMA, reason: 'invalid', count: p.errors.length }, preview: p };
      if (p.conflict && !overwrite) return { ok: false, error: { code: CODES.DUP, field: 'universe', existing: p.conflict } };
      const copy = clone(d);
      // 내장 샘플 ID면 그 판(created_at)을 따라 "고친 샘플"로 둔다. 다시 열 때 새 샘플로 바뀌어 사라지지 않게(검토 2026-10-03)
      const sample = samples.find((s) => s.universe.id === copy.universe.id);
      if (sample) Object.assign(copy.universe, { is_sample: true, created_at: sample.universe.created_at });
      else copy.universe.is_sample = false;
      const failed = save(copy);
      if (failed) return failed;
      if (copy.universe.id === doc.universe.id) doc = copy;
      return { ok: true, doc: copy };
    },

    /**
     * 인수인계 초안 확정(R-03 ③, CR-8 사용자 결정 2026-10-03 "추천하는 걸로 구현").
     * 초안 대상의 유니버스에 ① 인수인계서(산출물, 확정자·시각·본문) ② 업무 → 인수인계서 산출 연결 ③ 인수인계 이력을 남긴다.
     * 인수인계할 업무: 대상이 업무면 그 업무, 꼭지면 범위 업무 중 보내는 사람이 맡았던(수행 연결) 업무.
     * 이전 인수인계가 있으면 바로 앞 것을 가리킨다(반복 비효율 ①의 "이어받음", D2-6).
     * @param {{draft:{target:string, from:string, to:string, title:string, method?:string}, text:string, date:string}} input
     * @returns {{ok:true, doc:object, artifact:string, works:string[]} | {ok:false, error:object}}
     */
    confirmHandover({ draft, text, date }) {
      if (guard()) return guard();
      const v = buildView(doc, resolve);
      const target = draft && v.getNode(draft.target);
      if (!target || !DRAFT_TARGET_TYPES.includes(target.core_type)) return { ok: false, error: { code: CODES.SCHEMA, field: 'target' } };
      const uid = target.universe_id;
      let d = uid === doc.universe.id ? doc : db.loadUniverse(uid);
      if (!d) return { ok: false, error: { code: CODES.SCHEMA, field: 'universe_id' } };
      const local = (gid) => (gid.startsWith(`${uid}/`) ? gid.slice(uid.length + 1) : gid); // 다른 유니버스는 전역 참조 그대로
      const canon = (ev, id) => v.canonical(refGid(ev.universe_id, id));
      const performed = (w) => v.edges.some((e) => !e.hidden && e.core_type === 'performs' && e.target === w && e.source === draft.from);
      const works = target.core_type === 'work' ? [target.gid] : scopeWorks(v, target.gid).map((g) => v.canonical(g)).filter(performed);
      if (!works.length) return { ok: false, error: { code: CODES.CONFIRM, reason: 'no_work' } };
      const handovers = v.events.filter((ev) => ev.type === 'handover');
      const dup = handovers.some((ev) => ev.occurred_at === date && works.includes(canon(ev, ev.payload.work_id)) &&
        canon(ev, ev.payload.from_person_id) === draft.from && canon(ev, ev.payload.to_person_id) === draft.to);
      if (dup) return { ok: false, error: { code: CODES.CONFIRM, reason: 'duplicate' } };

      const ctx = { now: now() };
      const step = (r) => {
        if (!r.ok) throw Object.assign(new Error('confirm'), { result: r });
        d = r.doc;
        return r;
      };
      try {
        if (!subtypeRegistered(d, 'artifact', SUBTYPE_HANDOVER_DOC)) step(addSubtype(d, { core_type: 'artifact', name: SUBTYPE_HANDOVER_DOC }));
        // 본문: 설명(2000자)에 넣고, 넘치면 "본문(이어서 N)" 속성으로 나눠 잃지 않게 한다
        const body = String(text || '');
        const extra = {};
        for (let i = TEXT_MAX, k = 1; i < body.length; i += TEXT_MAX, k += 1) extra[`본문(이어서 ${k})`] = body.slice(i, i + TEXT_MAX);
        const base = `${date} ${target.label} 인수인계서`.slice(0, 90);
        const taken = new Set(d.nodes.filter((n) => n.core_type === 'artifact' && !n.hidden).map((n) => n.label));
        let label = base;
        for (let k = 2; taken.has(label); k += 1) label = `${base} (${k})`;
        const name = (gid) => (v.getNode(gid) || { label: gid }).label;
        const art = step(addNode(d, {
          core_type: 'artifact', subtype: SUBTYPE_HANDOVER_DOC, label, description: body.slice(0, TEXT_MAX),
          attrs: { 확정자: '사용자(이 브라우저)', '확정 시각': ctx.now, '보내는 사람': name(draft.from), '받는 사람': name(draft.to), ...(draft.method ? { '초안 생성 방식': METHOD_NAMES[draft.method] || draft.method } : {}), ...extra },
        }, ctx)).node;
        let linked = false;
        for (const w of works) {
          if (w.startsWith(`${uid}/`)) {
            step(addEdge(d, { source: local(w), target: art.id, core_type: 'produces', note: '인수인계 초안 확정' }, ctx));
            linked = true;
          }
          // 바로 앞 인수인계(이 업무의 마지막 인수인계)를 가리킨다
          const prev = handovers.filter((ev) => canon(ev, ev.payload.work_id) === w).pop();
          step(addEvent(d, {
            type: 'handover', occurred_at: date,
            payload: { work_id: local(w), from_person_id: local(draft.from), to_person_id: local(draft.to), artifact_id: art.id, ...(prev ? { previous_handover_id: local(prev.gid) } : {}) },
            note: '인수인계 초안을 확정함(확정: 사용자(이 브라우저))',
          }, ctx));
        }
        if (!linked) step(addEdge(d, { source: d.universe.root_node_id, target: art.id, core_type: 'contains' }, ctx));
        const failed = save(d);
        if (failed) return failed;
        if (uid === doc.universe.id) doc = d;
        return { ok: true, doc: d, artifact: toGid(uid, art.id), works };
      } catch (err) {
        if (err.result) return err.result;
        throw err;
      }
    },

    /** 내보내기(D-06): 현재 유니버스 문서를 JSON 글로. 다른 PC로 옮기거나 백업할 때 쓴다 */
    exportJson() {
      return JSON.stringify(doc, null, 2);
    },

    /** 현재 유니버스에서 하위 유니버스를 뺀다(참조 해제, 원본은 그대로) */
    removeChild(childId) {
      return guard() || commit(hideRef(doc, childId, { now: now() }));
    },

    // 가상 데이터 초기화(6절 복구): 모든 샘플을 처음 상태로 되돌리고 사용자가 만든 유니버스를 지운다
    // 목록에 없는 유니버스 키(목록 쓰기 실패로 남은 것)도 지운다. 저장이 실패하면 {ok:false}
    resetAll() {
      if (!store) return { ok: false, error: { code: CODES.STORAGE } };
      try {
        const keep = new Set(samples.map((s) => s.universe.id));
        for (const e of store.listUniverses()) if (!keep.has(e.id)) store.removeUniverse(e.id);
        if (store.purgeExcept) store.purgeExcept(keep);
        for (const sample of samples) store.saveUniverse(clone(sample));
      } catch (err) {
        return { ok: false, error: { code: CODES.STORAGE, reason: storageFailReason(err) } };
      }
      db = store;
      writable = true;
      doc = db.loadUniverse(samples[0].universe.id);
      return { ok: true };
    },
  };
}
