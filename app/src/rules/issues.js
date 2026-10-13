// 미해결 메모 판정(R-20, D-22). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules).
// 인수인계 초안의 「진행 중인 일」(rules/handover.js)과 같은 코드를 쓴다 — 두 화면의 판정이 어긋나지 않게 하기 위해서다.
//
// 닫힘 규칙: 메모 범주가 진행 중인 메모는, 같은 대상(대상이 없으면 단 주제 집합이 같은 것)에 이력 순서상 뒤에
// 범주 「해결됨」 메모가 있으면 닫힌 것이다. 같은 날짜면 기록 순서로 본다(tech-record 14절).
// 범주 「이슈」는 초안에서는 「최근 이슈」로 따로 보이고 닫힘 판정을 받지 않지만, 미해결 목록에서는 같은 규칙으로 닫는다(C12-1).

import { refGid } from '../view/view.js';
import { memoCategoryOf } from '../model/schema.js';

/** 미해결 목록에 오르는 범주(이슈, 진행 중) */
export const OPEN_CATEGORIES = ['issue', 'in_progress'];

/** 메모의 대상(전역 참조, 합쳐진 노드는 대표 노드로). 대상이 없으면 null */
export const memoTarget = (view, ev) => (ev.payload.target_id ? view.canonical(refGid(ev.universe_id, ev.payload.target_id)) : null);

/** 메모가 닫히는 단위: 같은 대상, 대상이 없으면 같은 주제 집합 */
export const memoKey = (view, ev) => memoTarget(view, ev) || `topics:${[...ev.node_gids].sort().join(',')}`;

/**
 * 아직 닫히지 않은 메모.
 * @param view 합성 뷰
 * @param opts.memos 판정할 메모 이벤트 목록(범위를 이미 걸렀으면 그것). 없으면 뷰의 모든 메모. "해결됨"도 이 목록 안에서 찾는다
 * @param opts.categories 돌려줄 범주(기본: 이슈, 진행 중)
 * @returns 뷰의 이력 순서를 유지한 메모 이벤트 배열
 */
export function openMemos(view, { memos = null, categories = OPEN_CATEGORIES } = {}) {
  const pool = memos || view.events.filter((ev) => ev.type === 'memo');
  const resolved = pool.filter((ev) => memoCategoryOf(ev.payload) === 'resolved');
  const order = new Map(view.events.map((ev, i) => [ev, i]));
  return pool
    .filter((ev) => categories.includes(memoCategoryOf(ev.payload)))
    .filter((ev) => {
      const k = memoKey(view, ev);
      const at = order.get(ev);
      return !resolved.some((r) => memoKey(view, r) === k && order.get(r) > at);
    });
}

const SUMMARY_MAX = 40;

/**
 * 「해결로 표시」로 추가할 새 메모의 입력. 같은 대상·같은 주제, 범주 resolved.
 * 날짜는 오늘이되 원래 메모보다 앞서지 않게 한다(앞서면 이력 순서상 닫지 못한다).
 */
export function resolveMemoInput(ev, today) {
  const note = String(ev.note || '').trim();
  const head = note.length > SUMMARY_MAX ? `${note.slice(0, SUMMARY_MAX)}…` : note;
  const payload = { category: 'resolved' };
  if (ev.payload.target_id) payload.target_id = ev.payload.target_id;
  if (ev.payload.topic_ids && ev.payload.topic_ids.length) payload.topic_ids = [...ev.payload.topic_ids];
  return {
    type: 'memo',
    occurred_at: ev.occurred_at > today ? ev.occurred_at : today,
    payload,
    note: head ? `해결: ${head}` : '해결',
  };
}
