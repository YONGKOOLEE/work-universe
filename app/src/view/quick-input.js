// 일상 사용 G2(CR-18-8, 2026-10-24 승인) 순수 계산 모음. DOM·저장소를 쓰지 않는다(화면은 ui/main.js).
// D-5 사람 인수인계 초안의 대상 지도, D-6 「이 사람 일, 누가 대신할 수 있나」 표, D-8 협업자 추가 묶음, D-10 「이번 주 기록」 입력.
// 동작이 갈릴 수 있는 값은 아래 상수 한 곳에 둔다(승인 문서에 수치가 없어 "답이 없으면" 값으로 정함. docs/decisions-pending.md에 쌓음).

import { toGid } from './view.js';
import { isCurrent, similarExperts, NAME_ONLY_NOTE, personLoad } from '../rules/insight.js';
import { normalizeLabel, pairAllowed } from '../model/schema.js';

/** D-6: 맡은 업무 하나마다 보이는 대신할 수 있는 후보의 최대 수 */
export const PERSON_BACKUP_TOP = 3;
/** D-6: 후보가 없을 때의 한 줄 */
export const BACKUP_NONE_TEXT = '후보 없음 — 비슷한 일을 해 본 기록이 없습니다';
/** D-10: 「이번 주 기록」의 분류 처음 값(주간 기록은 진행 상황이 대부분이라 진행 중). 이슈로 바꾸려면 'issue' */
export const WEEKLY_DEFAULT_CATEGORY = 'in_progress';
/** D-8: 협업자 추가가 만드는 연결 — 업무 → 협업자 「참조」(schema.js PAIR_RULES의 references: 꼭지 외 노드 → 꼭지 외 노드). false면 협업자 → 업무 */
export const COLLAB_FROM_WORK = true;
/** D-8: 협업자 사람 노드에 넣는 속성 이름(인수인계 초안 「관계자·연락처」가 읽는 이름과 같다) */
export const COLLAB_ATTR_AFFILIATION = '소속';
export const COLLAB_ATTR_CONTACT = '연락처';

// ── D-5: 사람 인수인계 초안의 대상 지도 ──

/**
 * 그 사람이 기준일에 진행 중으로 맡은 업무가 있는 지도(유니버스) 중 하나를 골라 그 지도 중심(꼭지)을 돌려준다.
 * 진행 중 수행 업무가 가장 많은 지도, 같으면 화면 순서(view.universes 순서: 위층 → 하위 지도를 묶은 순서) 앞쪽.
 * 맡은 업무가 없거나 사람이 아니면 null(부르는 쪽이 지금 지도 전체로 되돌린다).
 * 지도 = 수행 연결이 기록된 문서. 같은 업무를 두 지도가 모두 잇고 있어도 지도마다 한 번 센다.
 * @returns {{universe_id:string, root_gid:string, count:number, counts:{universe_id:string, count:number}[]}|null}
 */
export function draftCenterFor(view, personGid, { asOf }) {
  const person = view.getNode(personGid);
  if (!person || person.core_type !== 'person') return null;
  const load = personLoad(view, person.gid, { asOf });
  if (!load || !load.works.length) return null;
  const mine = new Set(load.works.map((w) => w.gid));
  const perUniverse = new Map(); // 유니버스 ID → 업무 gid 집합
  for (const e of view.edges) {
    if (e.hidden || e.core_type !== 'performs' || e.source !== person.gid || !mine.has(e.target) || !isCurrent(e.period, asOf)) continue;
    if (!perUniverse.has(e.universe_id)) perUniverse.set(e.universe_id, new Set());
    perUniverse.get(e.universe_id).add(e.target);
  }
  const order = [...view.universes.keys()];
  const counts = [...perUniverse.entries()]
    .map(([universe_id, set]) => ({ universe_id, count: set.size }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.universe_id) - order.indexOf(b.universe_id));
  for (const c of counts) {
    const u = view.universes.get(c.universe_id);
    const root = u ? view.getNode(view.canonical(toGid(u.id, u.root_node_id))) : null;
    if (root && root.core_type === 'root') return { universe_id: c.universe_id, root_gid: root.gid, count: c.count, counts };
  }
  return null;
}

// ── D-6: 이 사람 일, 누가 대신할 수 있나 ──

const candidateOf = (p, kind) => {
  if (kind === 'direct') {
    const d = p.direct_works[0];
    return { gid: p.gid, label: p.label, kind, state: 'direct', text: `직접 해 봄(${d.period})`, note: '' };
  }
  const w = p.works[0];
  const now = p.works.some((x) => x.current);
  const nameOnly = p.works.every((x) => x.name_only);
  return {
    gid: p.gid,
    label: p.label,
    kind,
    state: now ? 'current' : 'ended',
    text: `${now ? '비슷한 일을 지금 담당 중' : '비슷한 일을 해 봄(끝남)'} — 「${w.label}」${p.works.length > 1 ? ` 외 ${p.works.length - 1}건` : ''}`,
    note: nameOnly ? NAME_ONLY_NOTE : '',
  };
};

/**
 * 그 사람이 기준일에 진행 중으로 맡은 업무마다 대신할 수 있는 후보(기존 유사 경험자 계산 그대로, 읽기만).
 * 후보 순서: 그 업무를 직접 해 본 사람 → 비슷한 일을 해 본 사람(점수순). 같은 사람은 한 번만. 역할 이름 노드는 사람이 아니므로 뺀다.
 * state: direct(이 업무를 직접 해 봄, 끝남) | current(비슷한 일을 지금 담당 중) | ended(비슷한 일을 해 봤고 끝남)
 * @returns {{work:{gid:string,label:string}, status:string, total:number, candidates:object[]}[]}
 */
export function backupRows(view, personGid, { asOf, top = PERSON_BACKUP_TOP }) {
  const person = view.getNode(personGid);
  if (!person || person.core_type !== 'person') return [];
  const load = personLoad(view, person.gid, { asOf });
  if (!load) return [];
  const limit = Math.max(1, Math.floor(Number(top)) || PERSON_BACKUP_TOP);
  return load.works.map((work) => {
    const r = similarExperts(view, { works: [work.gid], asOf, exclude: [person.gid] });
    const direct = r.direct || [];
    const rest = (r.people || []).filter((p) => !direct.some((d) => d.gid === p.gid));
    const all = [...direct.map((p) => candidateOf(p, 'direct')), ...rest.map((p) => candidateOf(p, 'similar'))];
    return { work, status: r.status, total: all.length, candidates: all.slice(0, limit) };
  });
}

// ── D-8: 협업자 추가 ──

/**
 * 업무 상세 「협업자 추가」(이름·소속·연락처)가 저장할 묶음 명령. 한 번의 applyBatch(한 번의 기록·되감기 한 점).
 *  - 같은 이름의 사람이 이 지도에 이미 있으면 새로 만들지 않고 연결만(existing: true. 소속·연락처는 바꾸지 않는다 — ignored: 입력이 있었는지)
 *  - 없으면 사람 노드(속성 소속·연락처, 비우면 없음) + 「참조」 연결
 * 이름이 비면 empty, 같은 이름이 둘 이상이면 ambiguous, 관계 방향이 schema의 허용 쌍이 아니면 pair.
 * @param {{id:string,label:string}[]} persons 이 지도의 사람 노드(숨김 제외)
 */
export function collabPlan(persons, { name, affiliation = '', contact = '' }, workId) {
  const label = String(name ?? '').trim();
  if (!label) return { ok: false, reason: 'empty' };
  if (!pairAllowed('references', ...(COLLAB_FROM_WORK ? ['work', 'person'] : ['person', 'work']))) return { ok: false, reason: 'pair' };
  const key = normalizeLabel(label);
  const hits = persons.filter((p) => normalizeLabel(p.label) === key);
  if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
  const attrs = {};
  const aff = String(affiliation ?? '').trim();
  const con = String(contact ?? '').trim();
  if (aff) attrs[COLLAB_ATTR_AFFILIATION] = aff;
  if (con) attrs[COLLAB_ATTR_CONTACT] = con;
  const edge = (personRef, row) => ({ op: 'addEdge', row, input: { core_type: 'references', source: COLLAB_FROM_WORK ? workId : personRef, target: COLLAB_FROM_WORK ? personRef : workId } });
  if (hits.length === 1) return { ok: true, existing: true, ignored: !!(aff || con), label: hits[0].label, ops: [edge(hits[0].id, 1)] };
  return {
    ok: true,
    existing: false,
    ignored: false,
    label,
    ops: [{ op: 'addNode', row: 1, input: { core_type: 'person', label, ...(Object.keys(attrs).length ? { attrs } : {}) }, attachRoot: false }, edge('@1', 2)],
  };
}

// ── D-10: 이번 주 기록 ──

/**
 * 「이번 주 기록」 한 줄이 저장할 이력 메모 입력(기존 이력 추가의 메모와 같은 모양: app.addEvent). 업무·내용이 비면 오류 코드를 돌려준다.
 * 내용 앞뒤 공백은 지운다.
 */
export function weeklyMemoInput({ workId, category, note, date }) {
  if (!workId) return { ok: false, field: 'work_id' };
  if (!String(note ?? '').trim()) return { ok: false, field: 'note' };
  return { ok: true, input: { type: 'memo', occurred_at: date, payload: { target_id: workId, category: category || WEEKLY_DEFAULT_CATEGORY, topic_ids: [] }, note: String(note).trim() } };
}
