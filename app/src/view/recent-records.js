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
  MIN_CHARS: 2, // 공백을 뺀 낱말이 이 글자 수 미만이면 찾지 않는다(한 글자는 거의 다 맞는다)
  FEATURE_FEW: 2, // 기능 결과가 이 수 이하일 때만 기록 결과를 아래에 더한다(기능이 충분하면 기능이 먼저)
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

/** 사용자가 직접 남긴 기록 이벤트(recentRecords와 같은 기준)와 그 기록이 걸린 대상 */
function* userRecords(view) {
  for (const ev of view.events) {
    if (ev.source !== 'user' || !USER_EVENT_TYPES.includes(ev.type)) continue;
    const node = recordTarget(view, ev);
    if (node) yield { ev, node };
  }
}

/**
 * 기록에서 낱말 찾기: 사용자 기록의 메모 내용(note)과 내용 글(eventText)에서 대소문자·공백을 무시하고 부분 일치.
 * 기록 시각이 늦은 순 최대 limit건. 낱말이 너무 짧으면(MIN_CHARS 미만) 찾지 않는다.
 * @returns {{query:string, total:number, rows:{gid:string, date:string, recorded_at:string, target_gid:string, target:string, kind:string, text:string}[]}}
 */
export function searchRecords(view, query, { limit = RECORD_SEARCH.LIMIT, textMax = RECENT_RECORDS.TEXT_MAX, minChars = RECORD_SEARCH.MIN_CHARS } = {}) {
  const shown = String(query ?? '').replace(/\s+/g, ' ').trim();
  const q = foldText(shown);
  if (q.length < minChars) return { query: shown, total: 0, rows: [] };
  const hits = [];
  for (const { ev, node } of userRecords(view)) {
    const isMemo = ev.type === 'memo';
    const body = isMemo ? ev.note || '' : eventText(view, ev);
    if (!foldText(`${ev.note || ''} ${body}`).includes(q)) continue;
    hits.push({
      gid: ev.gid,
      date: ev.occurred_at,
      recorded_at: ev.recorded_at,
      target_gid: node.gid,
      target: displayName(node),
      kind: isMemo ? MEMO_CATEGORIES[memoCategoryOf(ev.payload)] || eventTypeLabel(ev.type) : eventTypeLabel(ev.type),
      text: clip(isMemo ? ev.note || '메모' : eventText(view, ev), textMax),
    });
  }
  hits.sort((a, b) => instant(b.recorded_at) - instant(a.recorded_at) || b.gid.localeCompare(a.gid));
  return { query: shown, total: hits.length, rows: hits.slice(0, limit) };
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
    });
  }
  return rows;
}
