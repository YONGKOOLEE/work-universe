// 「최근 기록」과 「이력에서 보기」의 순수 계산(CR-21 B). 화면(DOM)·저장소를 쓰지 않는다.
// 새 규칙을 만들지 않는다 — 뷰의 이벤트(합성 뷰라 묶은 지도면 묶인 지도의 기록도 들어 있다)를 고르고 줄 글만 만든다.

import { MEMO_CATEGORIES, USER_EVENT_TYPES, eventTypeLabel, memoCategoryOf } from '../model/schema.js';
import { displayName, eventText } from './describe.js';

// 바꾸기 쉬운 값은 한 곳에(연속 진행 모드 원칙)
export const RECENT_RECORDS = {
  LIMIT: 5, // 개요 「최근 기록」에 보이는 건수(CR-21 B-2)
  TEXT_MAX: 40, // 줄마다 보이는 내용 앞부분 글자 수
  JUST_ADDED_MS: 6000, // 방금 기록한 이력 줄의 강조가 남아 있는 시간
};

// 쓴 것 찾기(R11 FU6-4): 머리글 「무엇을 할까요?」의 「기록에서 …」 결과. 바꾸기 쉬운 값은 한 곳에
export const RECORD_SEARCH = {
  LIMIT: 8, // 한 번에 보이는 건수
  MINE_LIMIT: 3, // 「내가 쓴 메모」처럼 내 기록을 묻는 말이면 보여 주는 최근 직접 쓴 기록 수(FU8-9)
  MIN_CHARS: 2, // 공백을 뺀 낱말이 이 글자 수 미만이면 찾지 않는다(한 글자는 거의 다 맞는다)
  FEATURE_FEW: Infinity, // 기능 결과가 이 수 이하일 때만 기록 결과를 아래에 더한다. Infinity = 맞는 기록이 있으면 기능 결과 수와 상관없이 늘 아래에 보인다(R12 RV12C-6, 메인 결정; 예전 값 2)
};

const instant = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
};

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

/**
 * 기록이 걸린 대상 노드. 업무가 있으면 업무(담당 시작·인수인계 이력은 사람도 걸려 있다), 없으면 처음 걸린 노드.
 * 숨기거나 지운 노드만 걸린 기록은 그래프에서 고를 수 없으므로 null.
 */
export function recordTarget(view, ev) {
  const nodes = ev.node_gids.map((g) => view.getNode(g)).filter((n) => n && !n.hidden && !n.deleted);
  return nodes.find((n) => n.core_type === 'work') || nodes[0] || null;
}

/**
 * 사용자가 직접 남긴 기록(source가 user인 메모·인수인계·담당 시작/종료·소속 변경) 중 기록 시각이 늦은 순 최근 몇 건.
 * 샘플·시스템 기록, 생성·수정·숨김 같은 자동 기록은 넣지 않는다.
 * @returns {{gid:string, date:string, recorded_at:string, target_gid:string, target:string, kind:string, text:string}[]}
 */
export function recentRecords(view, { limit = RECENT_RECORDS.LIMIT, textMax = RECENT_RECORDS.TEXT_MAX } = {}) {
  const rows = [];
  for (const ev of view.events) {
    if (ev.source !== 'user' || !USER_EVENT_TYPES.includes(ev.type)) continue;
    const node = recordTarget(view, ev);
    if (!node) continue;
    const isMemo = ev.type === 'memo';
    rows.push({
      gid: ev.gid,
      date: ev.occurred_at,
      recorded_at: ev.recorded_at,
      target_gid: node.gid,
      target: displayName(node),
      // 메모는 분류(이슈·진행 중…)가 종류보다 알려 주는 것이 많다
      kind: isMemo ? MEMO_CATEGORIES[memoCategoryOf(ev.payload)] || eventTypeLabel(ev.type) : eventTypeLabel(ev.type),
      text: clip(isMemo ? ev.note || '메모' : eventText(view, ev), textMax),
    });
  }
  rows.sort((a, b) => instant(b.recorded_at) - instant(a.recorded_at) || b.gid.localeCompare(a.gid));
  return rows.slice(0, limit);
}

/**
 * 상세의 이력 목록에서 강조할 줄. items는 describeNode의 history(gid 포함), gids는 방금 기록한 이벤트 전역 ID들.
 * 이력이 많아 최근 show건만 보이는 접힘 상태(items가 collapseOver건을 넘을 때)에서 강조할 줄이 접힌 쪽이면 foldedAway를 참으로 돌려 목록을 펼치게 한다.
 * @returns {{gid:string|null, index:number, foldedAway:boolean}}
 */
export function historyFocus(items, gids, { show, collapseOver }) {
  const want = new Set(gids || []);
  const index = want.size ? items.findIndex((h) => want.has(h.gid)) : -1;
  if (index < 0) return { gid: null, index: -1, foldedAway: false };
  const collapsible = items.length > collapseOver;
  return { gid: items[index].gid, index, foldedAway: collapsible && index < items.length - show };
}

// ── 쓴 것 찾기·지도 전체 기록 표(R11 FU6-4). 읽기만 한다 — 저장·판정을 바꾸지 않는다 ──

/** 대소문자·공백을 무시하고 비교하려고 접은 글 */
export const foldText = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

// 사용자가 쓴 것이 아닌 기록 줄에 붙이는 출처 칩(R12 FU7-1). 값이 없는 source는 SOURCE_CHIP_OTHER. 바꾸기 쉬운 값은 한 곳에
export const SOURCE_CHIP = { sample: '예시' };
export const SOURCE_CHIP_OTHER = '가져옴';

/** 줄에 붙일 출처 칩 글자. 사용자가 쓴 기록이면 null */
export const sourceChipOf = (ev) => (ev.source === 'user' ? null : SOURCE_CHIP[ev.source] || SOURCE_CHIP_OTHER);

/**
 * 기록 종류(USER_EVENT_TYPES) 이벤트와 그 기록이 걸린 대상. source와 상관없이 모두 — 샘플 지도의 카드 이력에 보이는 기록이
 * 찾기·전체 기록 표에서만 빠지던 결함(R12 FU7-1). 「최근 기록」(recentRecords)은 CR-21 B-2대로 user만 쓴다.
 */
function* userRecords(view) {
  for (const ev of view.events) {
    if (!USER_EVENT_TYPES.includes(ev.type)) continue;
    const node = recordTarget(view, ev);
    if (node) yield { ev, node };
  }
}

/**
 * 기록 한 건에서 낱말을 찾을 글 조각들: 메모 내용(note), 내용 글, 걸린 대상 이름. 필드마다 따로 비교한다 —
 * 이어 붙여 공백을 지우면 경계를 넘는 글(「대사확인」에서 「확인대사」)도 맞던 결함(R12 RV12C-5).
 * 기록 찾기와 지도 전체 기록 표(view/card.js filterHistory가 row.fields를 본다)가 같은 규칙을 쓰게 한 곳에 둔다(RV12C-4)
 */
export function recordFields(view, ev, node) {
  const body = ev.type === 'memo' ? ev.note || '' : eventText(view, ev);
  // 분류(이슈·진행 중·해결됨…)도 찾는 글자에 든다: 「해결」로 찾으면 [해결됨] 기록도 걸린다(찾기 범위일 뿐 해결 판정이 아니다)
  return [ev.note || '', body, displayName(node), ev.type === 'memo' ? MEMO_CATEGORIES[memoCategoryOf(ev.payload)] || '' : eventTypeLabel(ev.type)];
}

/** 접은 글에 낱말(접은 것)이 들어 있는 조각이 하나라도 있는가 */
export const fieldsMatch = (fields, foldedQuery) => fields.some((f) => foldText(f).includes(foldedQuery));

/** 「내가 쓴 메모」·「내 기록」처럼 내가 직접 쓴 기록을 묻는 말인가(낱말 찾기가 아니라 최근 기록을 보여 줄 말) */
export const isMineQuery = (query) => /^내(가)?((쓴|적은|남긴|작성한)(것|메모|기록|글)?|(메모|기록|글))$/.test(foldText(query));

/**
 * 기록에서 낱말 찾기: 기록 종류 이벤트(출처 무관, 사용자가 쓴 것이 아니면 source_chip)의 메모 내용(note)과 내용 글(eventText)에서 대소문자·공백을 무시하고 부분 일치.
 * 기록 시각이 늦은 순 최대 limit건. 낱말이 너무 짧으면(MIN_CHARS 미만) 찾지 않는다.
 * @returns {{query:string, total:number, rows:{gid:string, date:string, recorded_at:string, target_gid:string, target:string, kind:string, text:string}[]}}
 */
export function searchRecords(view, query, { limit = RECORD_SEARCH.LIMIT, textMax = RECENT_RECORDS.TEXT_MAX, minChars = RECORD_SEARCH.MIN_CHARS } = {}) {
  const shown = String(query ?? '').replace(/\s+/g, ' ').trim();
  const q = foldText(shown);
  if (q.length < minChars) return { query: shown, total: 0, rows: [] };
  let mineNone = false;
  // 「내가 쓴 메모」: 낱말로는 글에 안 나오므로(메모 내용에 「내가 쓴」이 없다) 직접 쓴 최근 기록 몇 줄을 보여 준다
  if (isMineQuery(shown)) {
    const mine = recentRecords(view, { limit: RECORD_SEARCH.MINE_LIMIT, textMax }).map((r) => ({ ...r, source_chip: null }));
    if (mine.length) return { query: shown, total: mine.length, rows: mine, mine: true };
    mineNone = true; // 직접 쓴 기록이 아직 0건(RV13-7): 안내 한 줄과 함께 그 말이 든 기록을 일반 낱말로 찾아 보인다
  }
  const hits = [];
  for (const { ev, node } of userRecords(view)) {
    const isMemo = ev.type === 'memo';
    if (!fieldsMatch(recordFields(view, ev, node), q)) continue;
    hits.push({
      gid: ev.gid,
      date: ev.occurred_at,
      recorded_at: ev.recorded_at,
      target_gid: node.gid,
      target: displayName(node),
      kind: isMemo ? MEMO_CATEGORIES[memoCategoryOf(ev.payload)] || eventTypeLabel(ev.type) : eventTypeLabel(ev.type),
      text: clip(isMemo ? ev.note || '메모' : eventText(view, ev), textMax),
      source_chip: sourceChipOf(ev),
    });
  }
  hits.sort((a, b) => instant(b.recorded_at) - instant(a.recorded_at) || b.gid.localeCompare(a.gid));
  return { query: shown, total: hits.length, rows: hits.slice(0, limit), ...(mineNone ? { mineNone: true } : {}) };
}

/**
 * 지도 전체의 기록 표 줄(이력 표 ui/history-table.js를 지도 범위로 재사용). describeNode의 history 줄과 같은 모양에 target(업무 이름)·target_gid를 더했다.
 * 오래된 순으로 돌려준다 — view/card.js historyRows가 최신이 위로 정렬하고 범주·상태를 붙인다.
 */
export function mapHistoryRows(view) {
  const rows = [];
  for (const { ev, node } of userRecords(view)) {
    rows.push({
      gid: ev.gid,
      date: ev.occurred_at,
      type: ev.type,
      category: ev.type === 'memo' ? memoCategoryOf(ev.payload) : null,
      type_label: eventTypeLabel(ev.type),
      text: eventText(view, ev, { tagIssue: true }),
      after: false,
      target: displayName(node),
      target_gid: node.gid,
      source_chip: sourceChipOf(ev),
      fields: recordFields(view, ev, node),
    });
  }
  return rows;
}
