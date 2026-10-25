// 명령 흐름 조립과 현재 상태(12.7 app). 화면은 이 객체만 호출한다.

import {
  addAssignment, addEdge, addEvent, addNode, applyBatch, addRef, addSubtype, canDeleteNow, createUniverse, decideIdentity, deleteNodeNow, hideEdge, hideNode, hideRef, purgeNode, replaceEdge, restoreNode, updateEdge, updateNode,
} from '../model/commands.js';
import { applyRewindOps, editPoints, laterThanLast, pointLabel, rewind, rewindOps } from '../model/rewind.js';
import { CODES, DRAFT_TARGET_TYPES, SUBTYPE_HANDOVER_DOC, TEXT_MAX, normalizeLabel } from '../model/schema.js';
import { validateDocument } from '../model/validate.js';
import { applyStarter } from '../model/starter.js';
import { subtypeRegistered } from '../model/checks.js';
import { buildView, refGid, toGid } from '../view/view.js';
import { transferPlan } from '../view/transfer.js';

// 확정한 인수인계서에 남기는 초안 생성 방식의 표시 이름(llm/connector.js METHOD_LABELS의 짧은 꼴)
const DEFAULT_AUTHOR = '사용자(이 브라우저)'; // 작성자 이름이 비었을 때의 기록 주체(R-22)
const METHOD_NAMES = { rule: '규칙 기반', pregen: '사전 생성', llm: 'Claude API(실시간)' };
import { scopeWorks } from '../rules/handover.js';
import { openMemos, resolveMemoInput } from '../rules/issues.js';
import { cleanAuthorName } from '../store/local.js';
import { mergePlan } from '../merge/merge.js';
import { previewImport } from '../model/import.js';
import { formReport } from '../rules/form.js';

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

/**
 * 시각 문자열 now가 other보다 뒤이도록 한다(초 단위 기록이면 1초 뒤). 이미 그렇다면 now 그대로.
 * 원래 메모가 미래 시각(다른 PC 시계)이면 해결 메모도 그 미래 시각 바로 뒤로 저장된다(limits L-42).
 * 아니면 other + 1초를 now와 같은 시간대 표기(YYYY-MM-DDTHH:MM:SS±hh:mm 또는 Z)로 돌려준다. other를 읽을 수 없으면 now 그대로.
 */
export function laterThan(nowStr, other) {
  const a = Date.parse(nowStr);
  const b = Date.parse(other);
  if (Number.isNaN(a) || Number.isNaN(b) || a >= b + 1000) return nowStr;
  const m = /([+-])(\d{2}):(\d{2})$/.exec(String(nowStr));
  const offMin = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const d = new Date(Math.floor(b / 1000) * 1000 + 1000 + offMin * 60000);
  const p = (n) => String(n).padStart(2, '0');
  const suffix = m ? `${m[1]}${m[2]}:${m[3]}` : 'Z';
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${suffix}`;
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
export function createApp({ store, samples, currentId, now, authorName, locked = false, clearLlmCache = null }) {
  const warnings = [];
  // 확정자·통합 확인 목록 판정(decideIdentity)의 기록 주체(R-22, D-24). 작성자 이름이 있으면 그 이름, 없거나 깨졌으면 지금 문구
  const author = () => cleanAuthorName(typeof authorName === 'function' ? authorName() : authorName) || DEFAULT_AUTHOR;
  let db = store || memoryStore();
  // locked: 내용 포함 HTML 보기(CR-13 B). 저장소 경고 없이 읽기 전용으로 연다
  let writable = !!store && !locked; // 저장소에 쓸 수 있는가. 샘플 설치가 실패하면 false(읽기 전용)
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
  const baseReadOnly = !writable || docReadOnly;
  let rewinding = false; // 편집 되감기로 옛 지도를 보는 중: 읽기 전용과 같은 길로 모든 편집을 막는다(CR-14 A)
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
  const guardBase = () => (!writable ? { ok: false, error: { code: CODES.STORAGE } } : docReadOnly ? { ok: false, error: { code: CODES.SCHEMA, reason: 'version' } } : null);
  const guard = () => guardBase() || (rewinding ? { ok: false, error: { code: CODES.SCHEMA, reason: 'rewinding' } } : null);

  return {
    get doc() {
      return doc;
    },
    // 화면과 규칙이 쓰는 합성 뷰(12.7). 현재 문서가 바뀔 때마다 새로 계산한다
    get view() {
      return buildView(doc, resolve);
    },
    // 읽기 전용: 저장소를 못 쓰거나 형식이 다르거나(고정) 편집 되감기로 옛 지도를 보는 중(일시)
    get readOnly() {
      return baseReadOnly || rewinding;
    },
    /** 되감기 모드와 무관한 읽기 전용(저장소·형식·내용 포함 HTML) */
    get baseReadOnly() {
      return baseReadOnly;
    },
    /** 편집 되감기 보기 모드를 켜고 끈다. 켜 있는 동안 저장하는 명령은 모두 거부된다(rewindTo는 예외) */
    setRewinding(on) {
      rewinding = !!on;
    },
    // 저장소 자체를 쓸 수 있는지(읽기 전용이어도 초기화로 복구할 수 있는 경우를 가르기 위해)
    canReset: !!store && !locked,
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

    /** 저장소의 유니버스 문서(없으면 null). 내용 포함 HTML 만들기에서 하위 유니버스를 모을 때 쓴다 */
    docOf(id) {
      return id === doc.universe.id ? doc : db.loadUniverse(id);
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
    /**
     * 노드 추가·수정 여러 개를 한 묶음으로 저장한다(T-19, D-18): 전부 아니면 전무, 브라우저 저장소 쓰기는 한 번.
     * 실패하면 문서·저장소 모두 그대로이고 {ok:false, errors:[{row, error}]} 또는 저장 실패(W-STORAGE)를 돌려준다.
     */
    applyBatch(ops) {
      return guard() || commit(applyBatch(doc, ops, { now: now() }));
    },
    hideNode(nodeId) {
      return guard() || commit(hideNode(doc, nodeId, { now: now() }));
    },
    /** 숨긴 노드를 되살린다(R-21, D-23). 저장 1회. 같은 이름의 보이는 노드가 있으면 E-DUP(existing_id) */
    restoreNode(nodeId) {
      return guard() || commit(restoreNode(doc, nodeId, { now: now() }));
    },
    /** 바로 삭제할 수 있는 노드인가(연결·다른 이력이 없음, CR-13 D) */
    canDeleteNow(nodeId) {
      return canDeleteNow(doc, nodeId, { externalRefs: this.externallyLinked(nodeId) });
    },
    /** 다른 유니버스(상위 묶음 등)의 동일성 연결(identity_links)이 이 노드를 가리키는가. 그러면 통째로 지우지 않고 자리표시로만 비운다 */
    externallyLinked(nodeId) {
      if (!db) return false;
      const gid = `${doc.universe.id}/${nodeId}`;
      return db.listUniverses().some((e) => {
        if (e.id === doc.universe.id) return false;
        const other = db.loadUniverse(e.id);
        return !!other && (other.identity_links || []).some((l) => l.a === gid || l.b === gid);
      });
    },
    /** 연결·이력이 없는 노드를 바로 지운다(되돌릴 수 없음). 저장 1회 */
    deleteNodeNow(nodeId) {
      return guard() || commit(deleteNodeNow(doc, nodeId, { now: now() }, { externalRefs: this.externallyLinked(nodeId) }));
    },
    /** 숨긴 노드를 완전히 삭제한다(자리표시로 비움, 되돌릴 수 없음). 저장 1회 */
    purgeNode(nodeId) {
      return guard() || commit(purgeNode(doc, nodeId, { now: now() }, { externalRefs: this.externallyLinked(nodeId) }));
    },
    addEdge(input) {
      return guard() || commit(addEdge(doc, input, { now: now() }));
    },
    updateEdge(edgeId, changes) {
      return guard() || commit(updateEdge(doc, edgeId, changes, { now: now() }));
    },
    /** 연결의 관계·상대를 바꾼다: 옛 연결 숨김 + 새 연결 생성을 저장 1회로(전부 아니면 전무) */
    replaceEdge(edgeId, input) {
      return guard() || commit(replaceEdge(doc, edgeId, input, { now: now() }));
    },
    hideEdge(edgeId) {
      return guard() || commit(hideEdge(doc, edgeId, { now: now() }));
    },
    addEvent(input) {
      // 담당 시작·종료는 수행 연결과 함께 한 번에 저장한다(담당 이력과 그래프가 따로 놀지 않게)
      const isAssign = input && (input.type === 'assign_start' || input.type === 'assign_end');
      return guard() || commit(isAssign ? addAssignment(doc, input, { now: now() }) : addEvent(doc, input, { now: now() }));
    },

    /**
     * 「이미 끝난 일(해결됨으로 기록)」(CR-18 D-12): 이슈 메모와 그것을 닫는 해결됨 메모(범주 resolved, resolves_id = 방금 이슈)를
     * 같은 날짜·같은 기록 시각으로 한 번의 저장에 남긴다(되감기 한 점). 저장 형식은 그대로(기존 필드만).
     * 이슈 메모가 아니거나(범주 issue만) 어느 한쪽이 거부되면 아무것도 저장하지 않는다.
     * 이력 순서(날짜 → 기록 시각 → ID)에서 해결됨이 이슈 뒤에 오도록, 같은 시각이면 ID가 뒤인 해결됨 메모가 나올 때까지 ID를 다시 뽑는다.
     * @returns {{ok:true, doc:object, event:object, resolvedEvent:object}|{ok:false, error:object}}
     */
    addMemoResolved(input) {
      if (guard()) return guard();
      const pl = (input && input.payload) || {};
      if (!input || input.type !== 'memo' || (pl.category || 'issue') !== 'issue') return { ok: false, error: { code: CODES.SCHEMA, field: 'category' } };
      const ctx = { now: now() };
      // 이슈 → 해결됨 순서로 쌓이는지는 이력 정렬(날짜 → 기록 시각 → 전역 ID)이 정한다. 같은 날짜·시각이면 ID 순이므로, 해결됨 ID가 이슈 ID보다 뒤인 짝이 나올 때까지 두 ID를 다시 뽑는다(짝마다 절반의 확률)
      const gidOf = (e) => toGid(doc.universe.id, e.id);
      let first = null;
      let second = null;
      for (let i = 0; i < 100 && !second; i += 1) {
        first = addEvent(doc, input, ctx);
        if (!first.ok) return first;
        const closing = resolveMemoInput({ id: first.event.id, note: input.note, occurred_at: input.occurred_at, payload: first.event.payload }, input.occurred_at);
        const r = addEvent(first.doc, closing, ctx);
        if (!r.ok) return r;
        if (gidOf(r.event).localeCompare(gidOf(first.event)) > 0) second = r;
      }
      if (!second) return { ok: false, error: { code: CODES.SCHEMA, field: 'event', not_closed: true } };
      // 저장 전에 해결됨 메모로 이슈가 실제로 닫히는지 본다(「해결로 표시」와 같은 확인)
      const closed = !openMemos(buildView(second.doc, (id) => (id === second.doc.universe.id ? second.doc : resolve(id)))).some((x) => x.gid === toGid(second.doc.universe.id, first.event.id));
      if (!closed) return { ok: false, error: { code: CODES.SCHEMA, field: 'event', not_closed: true } };
      const done = commit({ ok: true, doc: second.doc });
      return done.ok ? { ...done, event: first.event, resolvedEvent: second.event } : done;
    },

    /**
     * 「해결로 표시」(R-20, D-22): 미해결 메모와 같은 대상·주제로 범주 resolved인 새 메모를 이력에 추가한다. 원래 메모는 그대로.
     * 묶음 화면의 하위 유니버스 메모면 그 메모가 있는 유니버스 문서에 저장한다.
     * 이미 닫힌 메모(또는 없는 메모)면 아무것도 추가하지 않고 {ok:false, error:{code:'E-SCHEMA', field:'event', already_resolved:true}}.
     */
    resolveMemo(eventGid, today, memoText = '') {
      if (guard()) return guard();
      const v = buildView(doc, resolve);
      const ev = v.events.find((x) => x.gid === eventGid && x.type === 'memo');
      if (!ev || !openMemos(v).includes(ev)) return { ok: false, error: { code: CODES.SCHEMA, field: 'event', already_resolved: true } };
      const input = resolveMemoInput(ev, today, memoText);
      // 해결 메모의 기록 시각은 원래 메모보다 확실히 뒤(최소 1초)로 맞춘다: 같은 초면 ID 순이라 앞설 수 있다(검토7 V-1)
      const stamp = laterThan(now(), ev.recorded_at);
      // 저장 전에 새 해결 메모로 원래 메모가 실제로 닫히는지 본다(시계가 어긋나 이력 순서상 앞서면 닫히지 않는다. 검토7 K-4)
      const closes = (next) => {
        const root = ev.universe_id === doc.universe.id ? next : doc;
        return !openMemos(buildView(root, (id) => (id === ev.universe_id ? next : resolve(id)))).some((x) => x.gid === eventGid);
      };
      const notClosed = { ok: false, error: { code: CODES.SCHEMA, field: 'event', not_closed: true } };
      if (ev.universe_id === doc.universe.id) {
        const own = addEvent(doc, input, { now: stamp });
        if (own.ok && !closes(own.doc)) return notClosed;
        return commit(own);
      }
      const other = db.loadUniverse(ev.universe_id);
      if (!other) return { ok: false, error: { code: CODES.SCHEMA, field: 'universe_id' } };
      if (validateDocument(other).readOnly) return { ok: false, error: { code: CODES.SCHEMA, reason: 'version' } };
      const result = addEvent(other, input, { now: stamp });
      if (result.ok && !closes(result.doc)) return notClosed;
      if (result.ok) {
        const failed = save(result.doc);
        if (failed) return failed;
      }
      return result;
    },

    // 노드 수정. 다른 유니버스의 노드면 그 유니버스 문서를 고친다(예: 위로 드러내기)
    updateNode(universeId, nodeId, changes) {
      if (guard()) return guard();
      if (universeId === doc.universe.id) return commit(updateNode(doc, nodeId, changes, { now: now() }));
      const other = db.loadUniverse(universeId);
      if (!other) return { ok: false, error: { code: CODES.SCHEMA, field: 'universe_id' } };
      if (validateDocument(other).readOnly) return { ok: false, error: { code: CODES.SCHEMA, reason: 'version' } };
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
      // 「첫 업무(선택)」: 업무·담당자·산출물을 만든 뒤 저장은 한 번. 하나라도 실패하면 아무것도 저장하지 않는다
      const started = applyStarter(created.doc, input.starter, { now: now() });
      if (!started.ok) return started;
      const failedCreate = save(started.doc);
      if (failedCreate) return failedCreate;
      return { ...created, doc: started.doc, ...(started.created ? { starter: started.created } : {}) };
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
      return guard() || commit(decideIdentity(doc, { a, b, kind, method: 'human', status, reason, score, decided_by: author() }, { now: now() }));
    },

    /** 표준 양식 점검(T-20, R-16): 문서 하나의 업무 중 권장 항목이 빈 것. 막지 않고 알리기만 한다 */
    formReport(d) {
      try {
        return formReport(buildView(d, () => null));
      } catch {
        return { total: 0, incomplete: 0, works: [] }; // 형식 오류 문서는 검증 오류가 먼저 알린다
      }
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
    confirmHandover({ draft, text, date, transfer: wantTransfer = false }) {
      if (guard()) return guard();
      const v = buildView(doc, resolve);
      const target = draft && v.getNode(draft.target);
      if (!target || !DRAFT_TARGET_TYPES.includes(target.core_type)) return { ok: false, error: { code: CODES.SCHEMA, field: 'target' } };
      const uid = target.universe_id;
      let d = uid === doc.universe.id ? doc : db.loadUniverse(uid);
      if (!d) return { ok: false, error: { code: CODES.SCHEMA, field: 'universe_id' } };
      if (d !== doc && validateDocument(d).readOnly) return { ok: false, error: { code: CODES.SCHEMA, reason: 'version' } };
      // 대상 유니버스 안의 ID로. 묶은 화면에서 합쳐진 노드의 대표가 다른 유니버스에 있어도, 대상 유니버스에 원본이 있으면 그 원본의 ID를 쓴다
      // (전역 참조를 그대로 저장하면 그 유니버스를 단독으로 열 때 사람을 찾지 못한다, 여섯 번째 검토 C-2). 원본이 없으면 전역 참조 그대로
      const local = (gid) => {
        if (gid.startsWith(`${uid}/`)) return gid.slice(uid.length + 1);
        const own = ((v.getNode(gid) || {}).merged_from || []).find((g) => g.startsWith(`${uid}/`));
        return own ? own.slice(uid.length + 1) : gid;
      };
      const canon = (ev, id) => v.canonical(refGid(ev.universe_id, id));
      const performed = (w) => v.edges.some((e) => !e.hidden && e.core_type === 'performs' && e.target === w && e.source === draft.from);
      const works = target.core_type === 'work' ? [target.gid] : scopeWorks(v, target.gid).map((g) => v.canonical(g)).filter(performed);
      if (!works.length) return { ok: false, error: { code: CODES.CONFIRM, reason: 'no_work' } };
      const handovers = v.events.filter((ev) => ev.type === 'handover');
      const dup = handovers.some((ev) => ev.occurred_at === date && works.includes(canon(ev, ev.payload.work_id)) &&
        canon(ev, ev.payload.from_person_id) === draft.from && canon(ev, ev.payload.to_person_id) === draft.to);
      if (dup) return { ok: false, error: { code: CODES.CONFIRM, reason: 'duplicate' } };

      // 「담당도 넘기기」(CR-18-6): 보내는·받는 사람이 대상 유니버스 안에 있어야 수행 연결을 끝내고 만들 수 있다. 아니면 아무것도 바꾸지 않고 거부한다
      const plan = wantTransfer ? transferPlan(v, draft, uid) : null;
      if (plan && !plan.persons_ok) return { ok: false, error: { code: CODES.CONFIRM, reason: 'transfer_scope' } };

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
        // 설명은 앞뒤 공백을 지우므로(addNode) 설명 조각이 공백·줄바꿈으로 끝나지 않게 자르는 위치를 글자 앞으로 옮긴다.
        // 이어서 조각(속성)은 지우지 않으므로 그대로 이어 붙이면 원문과 같다(검토7 K-2)
        let first = Math.min(TEXT_MAX, body.length);
        if (first < body.length) {
          while (first > 0 && /\s/.test(body[first - 1])) first -= 1;
          if (first === 0) first = TEXT_MAX; // 공백만 2000자 이상: 어쩔 수 없이 그 자리에서 자른다
        }
        for (let i = first, k = 1; i < body.length; i += TEXT_MAX, k += 1) extra[`본문(이어서 ${k})`] = body.slice(i, i + TEXT_MAX);
        const base = `${date} ${target.label} 인수인계서`.slice(0, 90);
        // addNode는 공백·대소문자·한글 정규화로 이름을 비교하므로 같은 기준으로 겹침을 피한다(여섯 번째 검토 C-12)
        const taken = new Set(d.nodes.filter((n) => n.core_type === 'artifact' && !n.hidden).map((n) => normalizeLabel(n.label)));
        let label = base;
        for (let k = 2; taken.has(normalizeLabel(label)); k += 1) label = `${base} (${k})`;
        const name = (gid) => (v.getNode(gid) || { label: gid }).label;
        const art = step(addNode(d, {
          core_type: 'artifact', subtype: SUBTYPE_HANDOVER_DOC, label, description: body.slice(0, first),
          attrs: { 확정자: author(), '확정 시각': ctx.now, '보내는 사람': name(draft.from), '받는 사람': name(draft.to), ...(draft.method ? { '초안 생성 방식': METHOD_NAMES[draft.method] || draft.method } : {}), ...extra },
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
            note: `인수인계 초안을 확정함(확정: ${author()})`,
          }, ctx));
        }
        if (!linked) step(addEdge(d, { source: d.universe.root_node_id, target: art.id, core_type: 'contains' }, ctx));
        // 담당 넘기기: 확정과 같은 한 번의 기록(같은 시각·한 번의 저장)으로 보내는 사람의 수행을 끝내고(기존 연결 수정) 받는 사람의 수행을 새로 시작한다(시작일 = 오늘)
        const note = '인수인계 확정과 함께 담당을 넘김';
        if (plan) {
          for (const m of plan.moves) {
            const e = d.edges.find((x) => x.id === m.edge_id);
            step(addAssignment(d, { type: 'assign_end', occurred_at: date, payload: { person_id: e.source, work_id: e.target }, note }, ctx));
            step(addAssignment(d, { type: 'assign_start', occurred_at: date, payload: { person_id: plan.to_local, work_id: e.target }, note }, ctx));
          }
        }
        const failed = save(d);
        if (failed) return failed;
        if (uid === doc.universe.id) doc = d;
        return { ok: true, doc: d, artifact: toGid(uid, art.id), works, ...(plan ? { transfer: { moved: plan.moves.map((m) => m.work), already: plan.already, elsewhere: plan.elsewhere } } : {}) };
      } catch (err) {
        if (err.result) return err.result;
        throw err;
      }
    },

    /**
     * 「담당 바꾸기」(일상 사용 2회차 M3): 업무 하나의 담당을 한 번의 저장(되감기 한 점)으로 넘긴다 — 보내는 사람의 진행 중 수행을 끝내고(assign_end),
     * 받는 사람의 수행을 시작하며(assign_start), handover가 true면 인수인계 이력도 남긴다. 새 명령은 없다(addAssignment·addNode·addEvent를 묶음).
     * 받는 사람은 이 지도의 사람(toId) 또는 이름(toName: 같은 이름의 사람이 있으면 그 사람, 없으면 사람을 새로 만든다).
     * 거부(아무것도 저장하지 않음): 읽기 전용(guard), 업무·보내는 사람이 이 지도에 없음, 받는 사람 없음·같은 이름 둘 이상(reason 'ambiguous')·보내는 사람과 같음,
     * 날짜 없음·오늘보다 뒤(field 'occurred_at'), 보내는 사람이 진행 중이 아님(no_active)·받는 사람이 이미 담당 중(already_active) 등 addAssignment의 거부
     * @param {{workId:string, fromId:string, toId?:string, toName?:string, date:string, handover?:boolean}} input 모두 이 지도 문서 안의 ID
     * @returns {{ok:true, doc:object, to:object, created:boolean, handover:boolean} | {ok:false, error:object}}
     */
    changeAssignee({ workId, fromId, toId, toName, date, handover = false }) {
      if (guard()) return guard();
      const person = (id) => doc.nodes.find((n) => n.id === id && n.core_type === 'person' && !n.hidden);
      const work = doc.nodes.find((n) => n.id === workId && n.core_type === 'work' && !n.hidden);
      if (!work) return { ok: false, error: { code: CODES.SCHEMA, field: 'work_id' } };
      if (!person(fromId)) return { ok: false, error: { code: CODES.SCHEMA, field: 'person_id' } };
      if (!date) return { ok: false, error: { code: CODES.REQUIRED, field: 'occurred_at' } };
      if (String(date) > String(now()).slice(0, 10)) return { ok: false, error: { code: CODES.SCHEMA, field: 'occurred_at', future: true } };
      // 받는 사람: 고른 사람 → 이름이 같은 사람 → 새 사람
      let target = toId ? person(toId) : null;
      let create = null;
      if (!target) {
        const label = String(toName ?? '').trim();
        if (!label) return { ok: false, error: { code: CODES.REQUIRED, field: 'to_person_id' } };
        const hits = doc.nodes.filter((n) => n.core_type === 'person' && !n.hidden && normalizeLabel(n.label) === normalizeLabel(label));
        if (hits.length > 1) return { ok: false, error: { code: CODES.SCHEMA, field: 'to_person_id', reason: 'ambiguous' } };
        if (hits.length === 1) target = hits[0];
        else create = label;
      }
      if (target && target.id === fromId) return { ok: false, error: { code: CODES.SCHEMA, field: 'to_person_id', same_person: true } };
      const ctx = { now: now() };
      const note = '담당 바꾸기';
      let d = doc;
      const step = (r) => {
        if (!r.ok) throw Object.assign(new Error('assignee'), { result: r });
        d = r.doc;
        return r;
      };
      try {
        if (create) target = step(addNode(d, { core_type: 'person', label: create }, ctx)).node;
        step(addAssignment(d, { type: 'assign_end', occurred_at: date, payload: { person_id: fromId, work_id: workId }, note }, ctx));
        step(addAssignment(d, { type: 'assign_start', occurred_at: date, payload: { person_id: target.id, work_id: workId }, note }, ctx));
        if (handover) {
          // 바로 앞 인수인계(이 업무의 마지막 인수인계)를 가리킨다(확정 때와 같은 규칙, D2-6)
          const prev = d.events.filter((ev) => ev.type === 'handover' && ev.payload && ev.payload.work_id === workId)
            .sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.recorded_at).localeCompare(String(b.recorded_at))).pop();
          step(addEvent(d, { type: 'handover', occurred_at: date, payload: { work_id: workId, from_person_id: fromId, to_person_id: target.id, ...(prev ? { previous_handover_id: prev.id } : {}) }, note: `담당 바꾸기와 함께 남긴 인수인계 기록(기록: ${author()})` }, ctx));
        }
        const failed = save(d);
        if (failed) return failed;
        doc = d;
        return { ok: true, doc: d, to: target, created: !!create, handover: !!handover };
      } catch (err) {
        if (err.result) return err.result;
        throw err;
      }
    },

    // ── 편집 되감기(CR-14 A, R-25, D-30): 기록 시각 기준으로 지도가 고쳐진 시점을 보고 되돌린다 ──
    /** 편집 시점 목록 [{at, count, kinds}] 오래된 순(같은 기록 시각 = 한 판) */
    editPoints() {
      return editPoints(doc);
    },
    /** 되감기를 쓸 수 있는가. 다른 유니버스를 묶은 지도(상위)는 대상이 아니다: 하위 유니버스를 열어 되감는다 */
    rewindAvailable() {
      return !(doc.refs || []).some((r) => !r.hidden);
    },
    /** 그 시점의 지도(읽기 전용). 하위 유니버스는 지금 것 그대로. 저장하지 않는다 */
    viewAt(at) {
      const r = rewind(doc, at);
      if (!r.ok) return r;
      const past = r.doc;
      return { ok: true, doc: past, view: buildView(past, (id) => (id === doc.universe.id ? past : db.loadUniverse(id))), diff: r.diff, limits: r.limits };
    },
    /** 이 시점으로 되돌리면 무엇이 바뀌는지(적용하지 않음): {ok, counts, limits, ops} */
    rewindPreview(at) {
      return rewindOps(doc, at);
    },
    /**
     * 이 시점으로 되돌린다: 지금 문서를 그 시점과 같게 만드는 명령을 한 묶음으로 저장한다(전부 아니면 전무).
     * 거부: 읽기 전용·형식 다름·저장소 없음(guard), 묶은 지도(reason 'grouped'), 되돌릴 것 없음(field 'ops', nothing), 저장 실패(W-STORAGE)
     */
    rewindTo(at) {
      const g = guardBase();
      if (g) return g;
      if (!this.rewindAvailable()) return { ok: false, error: { code: CODES.SCHEMA, reason: 'grouped' } };
      const plan = rewindOps(doc, at);
      if (!plan.ok) return plan;
      if (!plan.ops.length) return { ok: false, error: { code: CODES.SCHEMA, field: 'ops', nothing: true } };
      // 되돌림이 마지막 편집과 같은 초에 기록되면 두 판이 합쳐져 되돌리기 직전으로 돌아갈 시점이 사라진다 → 마지막 기록보다 늦은 시각으로(재검증 결함 4)
      const res = applyRewindOps(doc, plan.ops, { now: laterThanLast(now(), doc.events) }, { resolve: (id) => db.loadUniverse(id), label: pointLabel(at), decidedBy: author() });
      if (!res.ok) return { ok: false, error: res.error };
      if (res.doc.events.length === doc.events.length) return { ok: false, error: { code: CODES.SCHEMA, field: 'ops', nothing: true } };
      const done = commit(res);
      return done.ok ? { ...done, counts: plan.counts, limits: plan.limits, skipped: res.skipped } : done;
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
      // 실시간 응답 캐시(wu:v1:llm-cache)도 지운다(R10-12). 데이터가 초기화되면 저장된 응답 문장이 남을 이유가 없다. 못 지워도 초기화는 성공이다
      try {
        if (typeof clearLlmCache === 'function') clearLlmCache();
      } catch {
        // 캐시는 근거 지문으로 다시 검증하므로 남아도 틀린 문장을 쓰지 않는다
      }
      return { ok: true };
    },
  };
}
