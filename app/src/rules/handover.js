// 규칙 기반 인수인계 초안(D-09, R-03·R-04). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules).
// 11개 항목은 고정이고(CR-6, CR-17 E로 「받는 범위와 담당 공백」 추가) 항목마다 근거를 찾는 규칙이 있다. 근거가 없으면 "이력 부족"으로 두고 내용을 만들지 않는다.
// 모든 문장에 근거 ID(전역 참조)를 붙인다. LLM은 이 근거로 문장만 다듬는다(llm/connector.js).
//
// 업무 고유 정보는 데이터 틀을 바꾸지 않고 노드의 자유 속성(attrs)과 메모로 담는다(R-07). 속성 이름은 약속이다(02-design 5.6):
//   업무: 절차, 사용 시스템, 주기, 마감, 주의사항 / 산출물: 위치 / 사람: 연락처 / 메모: payload.category

import { displayName, periodText } from '../view/describe.js';
import { parseGid, refGid } from '../view/view.js';
import { CODES, DRAFT_TARGET_TYPES, memoCategoryOf } from '../model/schema.js';
import { josa } from '../model/josa.js';
import { memoKey, memoTarget, openMemos } from './issues.js';
import { densityGaps, personLoad } from './insight.js';

export const HANDOVER_ITEMS = [
  { key: '업무_개요', title: '업무 개요' },
  { key: '받는_범위', title: '받는 범위와 담당 공백' }, // CR-17 E
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

// 관계자·연락처에 협업자로 셀 수 있는 노드 유형(CR-17 F). 「참조」로 이은 상대 중 사람·조직만. 바꾸려면 여기 한 곳
const COLLABORATOR_TYPES = ['person', 'org'];

// 최근 이슈로 보여 줄 메모 수(D-09 "최근 메모 N건")
export const RECENT_MEMO_COUNT = 3;

// 협업자 줄에 붙이는 연락처·소속(CR-18 D-9). 연락처는 속성 이름이 아래 중 무엇이어도 읽는다(값이 여럿이면 이 순서로 모아 ', '로 잇고 같은 값은 한 번). 소속은 속성 → 사람이면 노드 설명 순. 바꾸려면 여기 한 곳
export const CONTACT_ATTR_KEYS = ['연락처', '연락', '내선', '전화', '메일', '이메일'];
export const AFFILIATION_ATTR_KEYS = ['소속', '부서', '팀'];

// 「진행 중인 일」에 덧붙이는 「최근 해결」(CR-18 D-11): 기준일에서 이 일수 안에 해결된 메모. 줄이 많을 때는 가장 최근 것부터 RECENT_RESOLVED_MAX줄만
export const RECENT_RESOLVED_DAYS = 30;
export const RECENT_RESOLVED_MAX = 3;

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'.split('');
const live = (e) => !e.hidden;
const DAY_MS = 86400000;
const dayNumber = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS : null;
};
const attr = (node, key) => {
  const v = node.attrs && node.attrs[key];
  return v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim();
};

/** 협업자의 연락처(D-9): CONTACT_ATTR_KEYS 속성의 값을 모아 ', '로 잇는다. 없으면 null */
function contactOf(node) {
  const values = [...new Set(CONTACT_ATTR_KEYS.map((k) => attr(node, k)).filter(Boolean))];
  return values.length ? values.join(', ') : null;
}

/** 협업자의 소속(D-9): AFFILIATION_ATTR_KEYS 속성 중 처음 있는 값, 없으면 사람의 노드 설명. 없으면 null */
function affiliationOf(node) {
  for (const k of AFFILIATION_ATTR_KEYS) if (attr(node, k)) return attr(node, k);
  return node.core_type === 'person' && node.description && String(node.description).trim() ? String(node.description).trim() : null;
}

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

/** 받는 범위 항목이 비었을 때(판정은 했는데 해당 업무·공백이 없음) 보이는 이유 */
export const RANGE_NONE_REASON = '받는 사람이 이 범위에서 지금 맡은 업무는 아직 없고, 범위 안 업무는 모두 지금 담당이 있습니다'; // 재검증 R14-1: 넘겨받기 전의 흔한 경우를 사실대로

/** 이전 인수인계 항목이 비었는데 그 이유가 「오늘 같은 두 사람 사이의 기록을 뺌」일 때 보이는 이유(일상 사용 2회차 M8) */
export const PREVIOUS_SAME_DAY_REASON = '오늘 같은 두 사람 사이에 기록한 인수인계는 이 인수인계 자체라 빼었습니다';

const sentence = (text, evidence) => ({ text, evidence_ids: [...new Set(evidence)] });
const name = (view, gid) => {
  const n = view.getNode(gid);
  if (!n) return '(찾을 수 없는 항목)';
  return displayName(n);
};

/**
 * 받는 범위와 담당 공백 문장(CR-17 E).
 * ① 받는 사람이 범위 업무 중 지금 수행 중인 업무 ② 범위 업무 중 지금 담당이 없는 업무(densityGaps의 공백). 같은 상태·같은 사람이면 한 문장으로 묶는다.
 * noGap: 둘 다 없고 공백 판정도 할 수 있었다(담당 연결이 아예 없어 판정하지 못한 경우는 false → 「이력 부족」)
 */
function receivingRange(view, { to, works, workIds, asOf }) {
  const sentences = [];
  const nameOf = (gid) => name(view, gid);
  const mineSet = new Set(((personLoad(view, to, { asOf }) || {}).works || []).map((w) => w.gid));
  const mine = works.filter((w) => mineSet.has(w.gid));
  if (mine.length) {
    sentences.push(sentence(`${nameOf(to)}${josa(nameOf(to), '이/가')} 지금 맡은 일: ${mine.map((w) => w.label).join(', ')}.`, [to, ...mine.map((w) => w.gid)]));
  }
  const dg = densityGaps(view, { asOf });
  const order = new Map(works.map((w, i) => [w.gid, i]));
  const gaps = dg.gaps.filter((g) => workIds.has(g.gid)).sort((a, b) => order.get(a.gid) - order.get(b.gid));
  const groups = new Map();
  for (const g of gaps) {
    const key = [g.kind, g.last_end, g.last_person && g.last_person.gid, g.next_start, g.next_person && g.next_person.gid].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(g);
  }
  for (const list of groups.values()) {
    const g = list[0];
    const labels = list.map((x) => x.label).join('·');
    const topic = `${labels}${josa(labels, '은/는')}`;
    const text = g.kind === 'ended'
      ? `${topic} ${g.last_end} 이후 지금 담당이 없습니다${g.last_person ? `(마지막 담당 ${g.last_person.label})` : ''} — 누가 맡을지 확인하세요.`
      : g.kind === 'scheduled'
        ? `${topic} 지금 담당이 없고 ${g.next_start}부터 ${g.next_person.label}${josa(g.next_person.label, '이/가')} 맡을 예정입니다 — 시작 전까지는 공백입니다.`
        : `${topic} 담당 기록이 없습니다 — 누가 맡을지 확인하세요.`;
    sentences.push(sentence(text, list.flatMap((x) => x.evidence_ids)));
  }
  return { sentences, noGap: sentences.length === 0 && dg.status !== 'insufficient' };
}

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

  // 1-2) 받는 범위와 담당 공백(CR-17 E): 받는 사람이 대상 범위 업무 중 지금 수행 중인 업무 + 범위 안에서 지금 담당이 없는 업무.
  //    공백 판정은 인사이트 「밀집·공백」 탭과 같은 함수(densityGaps)를 쓴다(새 규칙을 만들지 않는다). 「지금」을 정할 기준일이 없으면 판정하지 않는다
  const range = asOf ? receivingRange(view, { to, works, workIds, asOf }) : { sentences: [], noGap: false };
  items.받는_범위 = range.sentences;

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
    if (w.description && w.gid !== start.gid) parts.push(` — ${w.description}`); // 대상 업무 자신의 설명은 「업무 개요」에 있으니 여기서는 절차·사용 시스템만(CR-17 G)
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
  // 최근 해결(CR-18 D-11): 기준일에서 RECENT_RESOLVED_DAYS일 안(기준일 당일 포함)에 기록된 「해결됨」 메모. 근거는 그 해결됨 메모 하나. 기준일이 없으면 만들지 않는다
  if (asOf) {
    const today = dayNumber(asOf);
    const originalNote = (ev) => {
      const original = ev.payload.resolves_id ? view.events.find((x) => x.gid === refGid(ev.universe_id, ev.payload.resolves_id)) : null;
      return original && original.note ? String(original.note).trim() : '';
    };
    const resolvedLine = (ev) => {
      const body = String(ev.note || '').trim().replace(/^해결:\s*/, '');
      return sentence(`최근 해결: ${body && body !== '해결' ? body : originalNote(ev) || '해결로 표시'}(${ev.occurred_at})`, [ev.gid]);
    };
    const recent = ofCategory('resolved').filter((ev) => {
      const d = dayNumber(ev.occurred_at);
      return today !== null && d !== null && today - d >= 0 && today - d <= RECENT_RESOLVED_DAYS;
    });
    items.진행_중.push(...recent.slice(-RECENT_RESOLVED_MAX).reverse().map(resolvedLine));
  }

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

  // 7) 관계자·연락처: 범위 안 업무를 수행한 사람 + 「참조」로 이은 협업자(사람·조직). 보내는 사람과 받는 사람은 뺀다(받는 사람에게 자신을 알려 줄 필요가 없음)
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
  // 협업자(CR-17 F): 범위 업무와 「참조」로 이어진 사람·조직(업무 → 상대 또는 상대 → 업무). 수행자로 이미 나온 사람, 보내는·받는 사람은 뺀다
  const collaborators = new Map();
  for (const e of view.edges) {
    if (!live(e) || e.core_type !== 'references') continue;
    const [workEnd, otherEnd] = workIds.has(e.source) ? [e.source, e.target] : workIds.has(e.target) ? [e.target, e.source] : [null, null];
    if (!workEnd || workIds.has(otherEnd) || otherEnd === from || otherEnd === to || people.has(otherEnd)) continue;
    const o = view.getNode(otherEnd);
    if (!o || o.hidden || !COLLABORATOR_TYPES.includes(o.core_type)) continue;
    if (!collaborators.has(o.gid)) collaborators.set(o.gid, { other: o, works: [] });
    const wn = name(view, workEnd);
    if (!collaborators.get(o.gid).works.includes(wn)) collaborators.get(o.gid).works.push(wn);
  }
  // 협업 줄(D-9): 소속·연락처가 있으면 덧붙인다. 없으면 이전 문장 그대로. 근거는 협업자 노드 하나
  const collabLine = ({ other, works: ws }) => {
    const aff = affiliationOf(other);
    const contact = contactOf(other);
    return sentence(`협업: ${other.label}${other.emp_no ? `(${other.emp_no})` : ''} — 참조 ${ws.join(', ')}${aff ? `. 소속: ${aff}` : ''}${contact ? `. 연락: ${contact}` : ''}`, [other.gid]);
  };
  items.관계자_연락처 = inquiry.concat([...people.values()].map(({ person, roles }) =>
    sentence(`${person.label}${person.emp_no ? `(${person.emp_no})` : ''} — ${roles.join(', ')}${attr(person, '연락처') ? `. 연락: ${attr(person, '연락처')}` : ''}`, [person.gid]),
  ), [...collaborators.values()].map(collabLine));

  // 8) 최근 이슈: 범주가 이슈(없으면 이슈)인 메모의 최근 N건. 이미 해결된 이슈(미해결 목록의 닫힘 규칙과 같은 판정, rules/issues.js)에는 「(해결됨 날짜)」를 덧붙이고
  //    닫은 해결됨 메모도 근거에 더한다(일상 사용 2회차 T3: 해결된 이슈가 해결 안 된 것처럼 읽히지 않게. 「진행 중인 일」의 최근 해결과 겹쳐 보여도 사실 그대로)
  const openIssues = new Set(openMemos(view, { memos, categories: ['issue'] }));
  const resolvers = memos.filter((ev) => memoCategoryOf(ev.payload) === 'resolved');
  const orderOf = new Map(view.events.map((ev, i) => [ev, i]));
  const closerOf = (ev) => resolvers
    .filter((r) => orderOf.get(r) > orderOf.get(ev) && (r.payload.resolves_id ? refGid(r.universe_id, r.payload.resolves_id) === ev.gid : memoKey(view, r) === memoKey(view, ev)))
    .sort((a, b) => orderOf.get(a) - orderOf.get(b))[0] || null;
  items.최근_이슈 = ofCategory('issue').slice(-RECENT_MEMO_COUNT).reverse().map((ev) => {
    const base = memoSentence(ev);
    const closer = openIssues.has(ev) ? null : closerOf(ev);
    return closer ? sentence(`${base.text} (해결됨 ${closer.occurred_at})`, [...base.evidence_ids, closer.gid]) : base;
  });

  // 9) 이전 인수인계: 범위 업무의 인수인계 이벤트 전부. 같은 두 사람 사이의 과거 인수인계도 받는 사람이 봐야 할 근거다(검토5 I-1).
  //    오늘(asOf) 같은 사람 사이에 이미 확정한 것만 "지금 만드는 인수인계"로 보고 뺀다
  const canonOf = (ev, id) => view.canonical(refGid(ev.universe_id, id));
  const samePair = (ev) => canonOf(ev, ev.payload.from_person_id) === from && canonOf(ev, ev.payload.to_person_id) === to;
  const scopedHandovers = view.events.filter((ev) => ev.type === 'handover' && workIds.has(canonOf(ev, ev.payload.work_id)));
  const sameDayPair = (ev) => !!asOf && ev.occurred_at === asOf && samePair(ev);
  items.이전_인수인계 = scopedHandovers
    .filter((ev) => !sameDayPair(ev))
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
        // 판정은 했지만 받는 사람이 맡을 업무도 담당 공백도 없음(기록이 모자란 것과 다름)
        ...(key === '받는_범위' && items[key].length === 0 && range.noGap ? { empty_reason: RANGE_NONE_REASON } : {}),
        // 일상 사용 2회차 M8: 이 범위의 인수인계 기록이 있는데 모두 「오늘 같은 두 사람 사이」라 뺐다(그 기록은 이 인수인계 자체) — 「이력 부족」이 아니라 「해당 없음」
        ...(key === '이전_인수인계' && items[key].length === 0 && scopedHandovers.some(sameDayPair) ? { empty_reason: PREVIOUS_SAME_DAY_REASON } : {}),
      })),
    },
  };
}

/** 항목의 근거 ID 합집합(정답 표 비교·근거 ID 검증용). 구현은 여기 한 벌이고 llm/providers.js가 가져다 쓴다(검토5 C-6, 12.7 의존 방향) */
export function itemEvidence(item) {
  return [...new Set(item.sentences.flatMap((s) => s.evidence_ids))].sort();
}
