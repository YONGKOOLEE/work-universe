// 미해결 메모 판정(R-20, D-22). 순수 함수이며 view(합성 뷰)만 입력으로 받는다(12.7 rules).
// 인수인계 초안의 「진행 중인 일」(rules/handover.js)과 같은 코드를 쓴다 — 두 화면의 판정이 어긋나지 않게 하기 위해서다.
//
// 닫힘 규칙: 메모 범주가 진행 중인 메모는, 같은 대상(대상이 없으면 단 주제 집합이 같은 것)에 이력 순서상 뒤에
// 범주 「해결됨」 메모가 있으면 닫힌 것이다. 같은 날짜면 기록 순서로 본다(tech-record 14절).
// 단, 해결됨 메모에 resolves_id(C12-8, 「해결로 표시」가 남김)가 있으면 그 메모 하나만 닫는다 — 한 업무의 미해결 여러 건을 따로 닫기 위해서다.
// 범주 「이슈」는 초안에서는 「최근 이슈」로 따로 보이고 닫힘 판정을 받지 않지만, 미해결 목록에서는 같은 규칙으로 닫는다(C12-9).

import { refGid, toGid } from '../view/view.js';
import { TEXT_MAX, memoCategoryOf } from '../model/schema.js';

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
      return !resolved.some((r) => {
        if (!(order.get(r) > at)) return false;
        const target = r.payload.resolves_id;
        // 지정한 해결: 같은 유니버스의 그 메모만
        if (target) return toGid(r.universe_id, target) === ev.gid;
        return memoKey(view, r) === k;
      });
    });
}

const SUMMARY_MAX = 40;

// 뷰의 이벤트는 전역 참조(gid = 유니버스/ID)를 가진다. 해결 메모는 그 메모가 있는 유니버스 문서에 저장하므로 로컬 ID를 쓴다
const localId = (ev) => ev.id || String(ev.gid).split('/').pop();

/**
 * 「해결로 표시」로 추가할 새 메모의 입력. 같은 대상·같은 주제, 범주 resolved.
 * 날짜는 오늘이되 원래 메모보다 앞서지 않게 한다(앞서면 이력 순서상 닫지 못한다).
 * memoText(CR-18 D-11, 선택): 사람이 적은 해결 메모. 앞뒤 공백을 뗀 뒤 비어 있지 않으면 그 글이 해결됨 메모의 내용이 된다(TEXT_MAX까지). 비었거나 글이 아니면 기본 내용(「해결: 원래 메모 앞부분」)
 */
export function resolveMemoInput(ev, today, memoText = '') {
  const note = String(ev.note || '').trim();
  const head = note.length > SUMMARY_MAX ? `${note.slice(0, SUMMARY_MAX)}…` : note;
  const written = typeof memoText === 'string' ? memoText.trim() : '';
  const payload = { category: 'resolved', resolves_id: localId(ev) };
  if (ev.payload.target_id) payload.target_id = ev.payload.target_id;
  if (ev.payload.topic_ids && ev.payload.topic_ids.length) payload.topic_ids = [...ev.payload.topic_ids];
  return {
    type: 'memo',
    occurred_at: ev.occurred_at > today ? ev.occurred_at : today,
    payload,
    note: written ? written.slice(0, TEXT_MAX) : head ? `해결: ${head}` : '해결',
  };
}

/** 한 묶음이 이 건수를 넘으면 목록에서 접어 둔다(R7-3) */
export const ISSUE_GROUP_OPEN_MAX = 2; // 이보다 많은 묶음은 접는다(부서 화면이 짧아지게, decisions-pending C12-13. 처음 값 5)

/**
 * 미해결 메모를 대상(업무)별로 묶는다(R7-3). 대상이 없는 메모는 target이 null인 「주제」 묶음 하나로 모은다.
 * 묶음 순서: 건수 많은 묶음 먼저, 같으면 가장 최근 날짜가 있는 묶음 먼저, 그래도 같으면 대상 참조 순(결정적).
 * 이유: 부서 화면처럼 한 업무에 메모가 몰릴 때 그 업무가 맨 위에 접힌 채 보여 목록이 짧아지고, 작은 묶음은 바로 펼쳐 읽을 수 있다.
 * 묶음 안은 입력의 역순(최근 기록이 위, 목록의 기존 순서)이다.
 * @param view 합성 뷰
 * @param memos openMemos 결과(이력 순서)
 * @returns {{key:string, target:string|null, items:object[], latest:string, collapsed:boolean}[]}
 */
export function groupIssues(view, memos) {
  const groups = new Map();
  for (const ev of [...memos].reverse()) {
    const target = memoTarget(view, ev);
    const key = target || 'topics';
    if (!groups.has(key)) groups.set(key, { key, target, items: [], latest: '' });
    const g = groups.get(key);
    g.items.push(ev);
    if (String(ev.occurred_at) > g.latest) g.latest = String(ev.occurred_at);
  }
  return [...groups.values()]
    .sort((a, b) => b.items.length - a.items.length || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((g) => ({ ...g, collapsed: g.items.length > ISSUE_GROUP_OPEN_MAX }));
}
