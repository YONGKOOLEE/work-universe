// 규칙 기반 인수인계 초안(D-09, R-03·R-04). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules).
// 10개 항목은 고정이고(CR-6) 항목마다 근거를 찾는 규칙이 있다. 근거가 없으면 "이력 부족"으로 두고 내용을 만들지 않는다.
// 모든 문장에 근거 ID(전역 참조)를 붙인다. LLM은 이 근거로 문장만 다듬는다(llm/connector.js).
//
// 업무 고유 정보는 데이터 틀을 바꾸지 않고 노드의 자유 속성(attrs)과 메모로 담는다(R-07). 속성 이름은 약속이다(02-design 5.6):
//   업무: 절차, 사용 시스템, 주기, 마감, 주의사항 / 산출물: 위치 / 사람: 연락처 / 메모: payload.category

import { displayName, periodText } from '../view/describe.js';
import { parseGid, refGid } from '../view/view.js';
import { CODES, DRAFT_TARGET_TYPES, memoCategoryOf } from '../model/schema.js';
import { memoTarget, openMemos } from './issues.js';

export const HANDOVER_ITEMS = [
  { key: '업무_개요', title: '업무 개요' },
  { key: '세부_업무_절차', title: '세부 업무·절차' },
  { key: '일정_마감', title: '일정·마감' },
  { key: '주의사항', title: '주의사항·노하우' },
  { key: '진행_중', title: '진행 중인 일' },
  { key: '산출물_문서', title: '산출물·문서 위치' },
  { key: '관계자_연락처', title: '관계자·연락처' },
  { key: '최근_이슈', title: '최근 이슈' },
  { key: '이전_인수인계', title: '이전 인수인계' },
  { key: '유사_경험자', title: '유사 경험자' },
];

// 최근 이슈로 보여 줄 메모 수(D-09 "최근 메모 N건")
export const RECENT_MEMO_COUNT = 3;

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.split('');
const live = (e) => !e.hidden;
const attr = (node, key) => {
  const v = node.attrs && node.attrs[key];
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
};

/**
 * 초안 대상의 범위: 대상 노드에서 포함(contains) 연결을 따라 내려간 업무들.
 * 대상이 꼭지면 그 유니버스(참조한 하위 유니버스 포함)의 업무, 업무면 그 업무와 하위 업무.
 */
function scopeOf(view, targetGid) {
  const start = view.getNode(targetGid);
  const works = [];
  const seen = new Set([start.gid]);
  const queue = [start.gid];
  if (start.core_type === 'work' && !start.hidden) works.push(start);
  while (queue.length) {
    const g = queue.shift();
    for (const e of view.edges) {
      if (!live(e) || e.core_type !== 'contains' || e.source !== g || seen.has(e.target)) continue;
      const child = view.getNode(e.target);
      if (!child || child.hidden) continue;
      seen.add(child.gid);
      queue.push(child.gid);
      if (child.core_type === 'work') works.push(child);
    }
  }
  return { start, works, workIds: new Set(works.map((w) => w.gid)) };
}

/**
 * 메모 범위: 범위 업무(또는 대상)를 가리키거나 그 업무와 관련된 주제를 단 메모. 주제는 여러 업무가 함께 쓰므로
 * 범위 업무가 속한 유니버스의 메모만 쓴다(다른 업무의 이슈가 섞이지 않게). 초안과 미해결 목록이 함께 쓴다.
 */
function memoScope(view, { start, works, workIds }) {
  const edgesFrom = (gid, type) => view.edges.filter((e) => live(e) && e.core_type === type && e.source === gid);
  const related = new Set([start.gid, ...workIds]);
  for (const w of works) for (const e of edgesFrom(w.gid, 'relates_to')) related.add(e.target);
  // 사람이 확인해 합친 노드는 합쳐진 쪽 유니버스의 메모도 범위에 든다(대표 노드의 유니버스만 보면 빠짐)
  const universeOf = (g) => parseGid(g).universe_id;
  const scopeUniverses = new Set([start, ...works].flatMap((n) => [n.universe_id, ...(n.merged_from || []).map(universeOf)]));
  const memos = view.events.filter((ev) => ev.type === 'memo' && scopeUniverses.has(ev.universe_id) && ev.node_gids.some((g) => related.has(g)));
  return { memos, related };
}

/**
 * 업무 하나에 대해 초안의 「주의사항」이 쓰는 범주 메모(주의사항)가 있는지. 초안과 같은 범위(memoScope)·같은 범주 판정이다.
 * 표준 양식 점검(rules/form.js)이 같이 쓴다 — 양식과 초안의 판정이 어긋나지 않게(D8-4).
 */
export function hasCautionMemo(view, workGid) {
  const node = view.getNode(workGid);
  if (!node || node.hidden) return false;
  return memoScope(view, scopeOf(view, node.gid)).memos.some((ev) => memoCategoryOf(ev.payload) === 'caution');
}

/** 대상(업무 또는 꼭지) 범위의 미해결 메모 — 초안의 「진행 중」과 같은 판정에 이슈 범주를 더한 목록(R-20) */
export function openMemosOf(view, targetGid) {
  const node = view.getNode(targetGid);
  if (!node) return [];
  return openMemos(view, { memos: memoScope(view, scopeOf(view, node.gid)).memos });
}

/** 초안 대상의 범위 업무(전역 참조). 유사 경험자 계산의 기준이 된다 */
export function scopeWorks(view, targetGid) {
  const target = view.getNode(targetGid);
  if (!target || !DRAFT_TARGET_TYPES.includes(target.core_type)) return [];
  return scopeOf(view, target.gid).works.map((w) => w.gid);
}

// 선후행 연결을 따라 업무를 진행 순서로 정렬한다. 연결이 없는 업무는 원래 순서를 지킨다. 순환이면 원래 순서
// chains: 선후행으로 이어진 묶음(연결 성분)마다 진행 순서 한 줄. 서로 이어지지 않은 사슬을 한 줄로 섞지 않는다(검토9 R-1)
function flowOrder(view, works, workIds) {
  const next = new Map(works.map((w) => [w.gid, []]));
  const comp = new Map(); // 연결 성분의 대표(합집합 찾기)
  const root = (g) => { let r = g; while (comp.has(r) && comp.get(r) !== r) r = comp.get(r); return r; };
  const indegree = new Map(works.map((w) => [w.gid, 0]));
  const linked = new Set();
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'precedes' || !workIds.has(e.source) || !workIds.has(e.target)) continue;
    next.get(e.source).push(e.target);
    indegree.set(e.target, indegree.get(e.target) + 1);
    linked.add(e.source).add(e.target);
    if (!comp.has(e.source)) comp.set(e.source, e.source);
    if (!comp.has(e.target)) comp.set(e.target, e.target);
    comp.set(root(e.target), root(e.source));
  }
  const order = [];
  const ready = works.filter((w) => indegree.get(w.gid) === 0).map((w) => w.gid);
  while (ready.length) {
    const g = ready.shift();
    order.push(g);
    for (const t of next.get(g)) {
      indegree.set(t, indegree.get(t) - 1);
      if (indegree.get(t) === 0) ready.push(t);
    }
  }
  if (order.length !== works.length) return { ordered: works, chains: [] }; // 순환: 순서를 정하지 않는다
  const byGid = new Map(works.map((w) => [w.gid, w]));
  const groups = new Map(); // 성분 대표 → 진행 순서(Map은 넣은 순서를 지키므로 먼저 나오는 묶음이 앞)
  for (const g of order) {
    if (!linked.has(g)) continue;
    const r = root(g);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(byGid.get(g));
  }
  return { ordered: order.map((g) => byGid.get(g)), chains: [...groups.values()] };
}

const sentence = (text, evidence) => ({ text, evidence_ids: [...new Set(evidence)] });
const name = (view, gid) => {
  const n = view.getNode(gid);
  if (!n) return '(찾을 수 없는 노드)';
  return displayName(n);
};

/**
 * @param {object} view buildView 결과
 * @param {{target:string, from:string, to:string, asOf?:string|null, similar?:object[], similarNone?:string}} input 전역 참조. target은 꼭지 또는 업무, from·to는 사람.
 *   asOf: 초안을 만드는 날(YYYY-MM-DD). 담당 기간의 "시작 예정" 판정과 "오늘 확정한 같은 인수인계"를 빼는 데 쓴다(검토5 I-1·I-8). 없으면 둘 다 하지 않는다
 *   similarNone: 유사 경험자를 비교했지만 해당자가 없을 때 그 이유. 있으면 "이력 부족" 대신 "해당 없음"으로 표시한다(N-5)
 * @returns {{ok:true, draft:object} | {ok:false, error:{code:string, field:string}}}
 */
export function buildHandoverDraft(view, input) {
  const asOf = input.asOf || null;
  for (const f of ['target', 'from', 'to']) {
    if (!input[f]) return { ok: false, error: { code: CODES.REQUIRED, field: f } };
  }
  const target = view.getNode(input.target);
  if (!target || !DRAFT_TARGET_TYPES.includes(target.core_type)) return { ok: false, error: { code: CODES.SCHEMA, field: 'target' } };
  if (target.hidden) return { ok: false, error: { code: CODES.SCHEMA, field: 'target', hidden: true } };
  for (const f of ['from', 'to']) {
    const p = view.getNode(input[f]);
    if (!p || p.core_type !== 'person') return { ok: false, error: { code: CODES.SCHEMA, field: f, expected: 'person' } };
    if (p.hidden) return { ok: false, error: { code: CODES.SCHEMA, field: f, hidden: true } };
  }
  const from = view.canonical(input.from);
  const to = view.canonical(input.to);
  if (from === to) return { ok: false, error: { code: CODES.SCHEMA, field: 'to', same_person: true } };

  const { start, works, workIds } = scopeOf(view, target.gid);
  const edgesFrom = (gid, type) => view.edges.filter((e) => live(e) && e.core_type === type && e.source === gid);
  const items = {};

  // 1) 업무 개요: 꼭지 또는 대상 업무의 설명
  items.업무_개요 = start.description ? [sentence(`${start.label}: ${start.description}`, [start.gid])] : [];

  // 2) 세부 업무·절차: 진행 순서로 나열. 업무별 설명·절차·사용 시스템. 선후행이 있으면 "진행 순서" 문장을 맨 앞에.
  //    이어진 묶음이 둘 이상이면 묶음마다 "진행 순서 ①: …" "진행 순서 ②: …"로 따로 쓴다(서로 무관한 사슬을 한 줄로 이으면 없는 순서를 말하게 된다, 검토9 R-1)
  const { ordered, chains } = flowOrder(view, works, workIds);
  items.세부_업무_절차 = [];
  const flows = chains.filter((c) => c.length >= 2);
  flows.forEach((chain, i) => {
    const head = flows.length === 1 ? '진행 순서' : `진행 순서 ${CIRCLED[i] || `(${i + 1})`}`;
    items.세부_업무_절차.push(sentence(`${head}: ${chain.map((w) => w.label).join(' → ')}`, chain.map((w) => w.gid)));
  });
  for (const w of ordered) {
    if (w.gid === start.gid && !attr(w, '절차') && !attr(w, '사용 시스템')) continue; // 대상 업무 자신은 개요에 이미 있다
    const parts = [w.label];
    if (w.description) parts.push(` — ${w.description}`);
    if (attr(w, '절차')) parts.push(` / 절차: ${attr(w, '절차')}`);
    if (attr(w, '사용 시스템')) parts.push(` / 사용 시스템: ${attr(w, '사용 시스템')}`);
    items.세부_업무_절차.push(sentence(parts.join(''), [w.gid]));
  }

  // 3) 일정·마감: 업무의 주기와 마감
  items.일정_마감 = ordered
    .filter((w) => attr(w, '주기') || attr(w, '마감'))
    .map((w) => sentence(`${w.label} — ${[attr(w, '주기') && `주기: ${attr(w, '주기')}`, attr(w, '마감') && `마감: ${attr(w, '마감')}`].filter(Boolean).join(', ')}`, [w.gid]));

  // 메모 범위: 범위 업무(또는 대상)를 가리키거나 그 업무와 관련된 주제를 단 메모. 주제는 여러 업무가 함께 쓰므로
  // 범위 업무가 속한 유니버스의 메모만 쓴다(다른 업무의 이슈가 섞이지 않게)
  const { memos, related } = memoScope(view, { start, works, workIds });
  // 메모의 대상(전역 참조). 대상이 범위 업무가 아니면(주제를 공유한 다른 업무의 메모) 문장에 그 업무 이름을 붙인다(검토5 I-9)
  const canonTarget = (ev) => memoTarget(view, ev);
  const memoSentence = (ev) => {
    const t = canonTarget(ev);
    const outside = t && !related.has(t) && view.getNode(t);
    return sentence(`${ev.occurred_at} ${ev.note || '메모'}${outside ? `(「${displayName(outside)}」 메모)` : ''}`, [ev.gid]);
  };
  const ofCategory = (cat) => memos.filter((ev) => memoCategoryOf(ev.payload) === cat);

  // 4) 주의사항·노하우: 업무 속성 + 범주가 주의사항인 메모
  items.주의사항 = [
    ...ordered.filter((w) => attr(w, '주의사항')).map((w) => sentence(`${w.label}: ${attr(w, '주의사항')}`, [w.gid])),
    ...ofCategory('caution').map(memoSentence),
  ];

  // 5) 진행 중인 일: 범주가 진행 중인 메모 중, 같은 대상에 이후 "해결됨" 메모가 없는 것.
  //    대상이 없는 메모는 단 주제 집합이 같은 "해결됨"으로 닫는다(검토5 I-10)
  //    판정은 미해결 이슈 목록(R-20)과 같은 함수를 쓴다(rules/issues.js)
  items.진행_중 = openMemos(view, { memos, categories: ['in_progress'] }).map(memoSentence);

  // 6) 산출물·문서 위치: 범위 업무의 산출 연결(만듦) + 산출물로 「참조」한 연결(참조, CR-17 J ⑩: 업무정의서 변환이 「관련 문서」를 참조로 잇는다). 근거는 산출물 노드. 위치 속성이 있으면 붙인다
  // 같은 업무가 같은 산출물을 만들고 참조하면 만듦 한 줄만. 참조는 산출물 유형 노드만(업무 → 주제 같은 참조는 이 항목이 아니다)
  const artifactLine = (w, e, verb) => {
    const art = view.getNode(e.target);
    const where = art && attr(art, '위치') ? `, 위치: ${attr(art, '위치')}` : '';
    return sentence(`${name(view, e.target)}${where} — ${w.label}에서 ${verb}`, [e.target]);
  };
  items.산출물_문서 = ordered.flatMap((w) => {
    const made = edgesFrom(w.gid, 'produces');
    const madeIds = new Set(made.map((e) => e.target));
    const referred = edgesFrom(w.gid, 'references').filter((e) => {
      const art = view.getNode(e.target);
      return !madeIds.has(e.target) && !!art && !art.hidden && art.core_type === 'artifact';
    });
    return [...made.map((e) => artifactLine(w, e, '만듦')), ...referred.map((e) => artifactLine(w, e, '참조'))];
  });

  // 7) 관계자·연락처: 범위 안 업무를 수행한 사람. 보내는 사람과 받는 사람은 뺀다(받는 사람에게 자신을 알려 줄 필요가 없음)
  const people = new Map();
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'performs' || !workIds.has(e.target) || e.source === from || e.source === to) continue;
    const p = view.getNode(e.source);
    if (!p || p.hidden) continue;
    if (!people.has(p.gid)) people.set(p.gid, { person: p, roles: [] });
    people.get(p.gid).roles.push(`${name(view, e.target)}${e.period ? ` ${periodText(e.period, asOf)}` : ''}`); // asOf가 있으면 "시작 예정"도 구분(검토5 I-8)
  }
  const sender = view.getNode(from);
  const inquiry = sender && attr(sender, '연락처')
    ? [sentence(`문의: 보내는 사람 ${sender.label}${sender.emp_no ? `(${sender.emp_no})` : ''} — 연락: ${attr(sender, '연락처')}`, [sender.gid])]
    : [];
  items.관계자_연락처 = inquiry.concat([...people.values()].map(({ person, roles }) =>
    sentence(`${person.label}${person.emp_no ? `(${person.emp_no})` : ''} — ${roles.join(', ')}${attr(person, '연락처') ? `. 연락: ${attr(person, '연락처')}` : ''}`, [person.gid]),
  ));

  // 8) 최근 이슈: 범주가 이슈(없으면 이슈)인 메모의 최근 N건
  items.최근_이슈 = ofCategory('issue').slice(-RECENT_MEMO_COUNT).reverse().map(memoSentence);

  // 9) 이전 인수인계: 범위 업무의 인수인계 이벤트 전부. 같은 두 사람 사이의 과거 인수인계도 받는 사람이 봐야 할 근거다(검토5 I-1).
  //    오늘(asOf) 같은 사람 사이에 이미 확정한 것만 "지금 만드는 인수인계"로 보고 뺀다
  const canonOf = (ev, id) => view.canonical(refGid(ev.universe_id, id));
  const samePair = (ev) => canonOf(ev, ev.payload.from_person_id) === from && canonOf(ev, ev.payload.to_person_id) === to;
  items.이전_인수인계 = view.events
    .filter((ev) => ev.type === 'handover' && workIds.has(canonOf(ev, ev.payload.work_id)))
    .filter((ev) => !(asOf && ev.occurred_at === asOf && samePair(ev)))
    .map((ev) => {
      const art = ev.payload.artifact_id ? canonOf(ev, ev.payload.artifact_id) : null;
      const who = `${name(view, canonOf(ev, ev.payload.from_person_id))} → ${name(view, canonOf(ev, ev.payload.to_person_id))}`;
      const basis = art ? ` (근거: ${name(view, art)})` : ' (인수인계서 없음)';
      return sentence(`${ev.occurred_at} ${who} — ${name(view, canonOf(ev, ev.payload.work_id))}${basis}`, art ? [ev.gid, art] : [ev.gid]);
    });

  // 10) 유사 경험자: D-08 결과(인사이트 규칙). 아직 없으면 이력 부족
  items.유사_경험자 = input.similar ? input.similar.map((s) => sentence(s.text, s.evidence_ids)) : [];

  return {
    ok: true,
    draft: {
      status: 'draft', // R-03 ③ 초안이며 사람이 확정한다
      method: 'rule',
      target: target.gid,
      from,
      to,
      title: `${name(view, from)} → ${name(view, to)} 인수인계 초안: ${target.label}`,
      items: HANDOVER_ITEMS.map(({ key, title }) => ({
        key,
        title,
        sentences: items[key],
        insufficient: items[key].length === 0, // R-03 ② 근거가 없으면 이력 부족
        // 비교는 했지만 해당자가 없음(기록이 모자란 것과 다름, N-5). 문장이 없는 것은 같아 insufficient는 그대로 둔다
        ...(key === '유사_경험자' && items[key].length === 0 && input.similarNone ? { empty_reason: input.similarNone } : {}),
      })),
    },
  };
}

/** 항목의 근거 ID 합집합(정답 표 비교·근거 ID 검증용). 구현은 여기 한 벌이고 llm/providers.js가 가져다 쓴다(검토5 C-6, 12.7 의존 방향) */
export function itemEvidence(item) {
  return [...new Set(item.sentences.flatMap((s) => s.evidence_ids))].sort();
}
