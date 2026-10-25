// CR-22 F(알림·동작) 순수 계산 모음. DOM·저장소를 쓰지 않아 Node 단위 테스트로 검증한다(화면은 ui/main.js·ui/memo-form.js·ui/notice.js).
//  1) 메모 양식 하나: 분류 칩(처음엔 고르지 않음), 「해결됨」 미리 알림의 건수
//  2) 담당 넘기기 한 입구: 갈래(담당만 / 인수인계서까지)별 결과와 초안에 채울 값
//  3) 성공 알림: 문구와 「거기로 가기」 대상
//  4) 하나씩 추가 양식의 이름 칸(담당자·산출물·다음 업무) → 표로 추가와 같은 한 행 처리
//  5) 묶은 직후 띠의 건수
// 판정·저장 형식은 바꾸지 않는다. 동작이 갈릴 수 있는 값은 아래 상수 한 곳에 둔다.

import { MEMO_CATEGORIES, normalizeLabel } from '../model/schema.js';
import { josa } from '../model/josa.js';
import { newRowsToOps } from '../model/table.js';
import { memoKey, openMemos } from '../rules/issues.js';

/** 성공 알림이 저절로 사라지는 시간(밀리초). 닫기 단추로 먼저 닫을 수 있다 */
export const NOTICE_MS = 10000;
/** 묶은 직후 띠·가져온 직후 띠처럼 다음 할 일이 있는 알림은 더 오래 둔다 */
export const NOTICE_LONG_MS = 30000;

// ── 1) 메모 양식 하나 ──

/** 분류 칩의 순서(보이는 순서). 처음엔 아무것도 고르지 않는다(사용자 결정 2026-10-26) */
export const MEMO_CHIP_ORDER = ['in_progress', 'issue', 'caution', 'resolved'];
export const CATEGORY_REQUIRED_TEXT = '분류를 고르세요';

/** 분류를 골랐는가: 안 골랐으면 「기록」 단추를 막고 한 줄을 보인다 */
export function categoryGate(category) {
  const ok = !!category && Object.hasOwn(MEMO_CATEGORIES, category);
  return { ok, text: ok ? '' : CATEGORY_REQUIRED_TEXT };
}

/**
 * 「해결됨」 메모를 새로 남길 때 함께 닫히는 미해결 건수: 같은 대상(업무)의 이슈·진행 중 메모 중 아직 닫히지 않은 것(rules/issues.js 규칙 그대로).
 * 「해결로 표시」는 한 건만 닫지만(resolves_id), 분류 「해결됨」으로 기록하면 그 업무 미해결이 모두 닫힌다.
 * @param view 합성 뷰
 * @param workGid 업무의 전역 참조
 */
export function resolveCloseCount(view, workGid) {
  if (!workGid) return 0;
  const key = view.canonical(workGid);
  return openMemos(view).filter((ev) => memoKey(view, ev) === key).length;
}

/** 「해결됨」을 고른 칩 아래 미리 알림 문구. 0건이면 닫을 것이 없다는 말 */
export function resolveWarningText(n) {
  return n > 0 ? `이 업무 미해결 ${n}건이 모두 닫힙니다` : '이 업무에 닫을 미해결은 없습니다';
}

/**
 * 메모 양식이 저장할 입력. 기존 이력 추가의 메모와 같은 모양(app.addEvent)이다. 분류·업무·내용이 비면 막는다.
 * 「이미 끝난 일」은 이슈일 때만 뜻이 있다(켜면 부르는 쪽이 addMemoResolved로 저장).
 * @returns {{ok:true, input:object, alsoResolved:boolean}|{ok:false, field:'work_id'|'category'|'note'}}
 */
export function memoRecordInput({ workId, category, note, date, topicIds = [], pastDone = false }) {
  if (!workId) return { ok: false, field: 'work_id' };
  if (!categoryGate(category).ok) return { ok: false, field: 'category' };
  const text = String(note ?? '').trim();
  if (!text) return { ok: false, field: 'note' };
  return {
    ok: true,
    alsoResolved: !!pastDone && category === 'issue',
    input: { type: 'memo', occurred_at: date, payload: { target_id: workId, category, topic_ids: [...topicIds] }, note: text },
  };
}

// ── 2) 담당 넘기기 한 입구 ──

export const BRANCH_ONLY = 'only';
export const BRANCH_DOC = 'doc';
export const BRANCH_LABELS = { [BRANCH_ONLY]: '담당만 바꾸기(이력만 남김)', [BRANCH_DOC]: '인수인계서까지(초안 화면에서 이어서)' };

/**
 * 「담당 넘기기」 상자의 갈래별 결과.
 *  - only: 지금의 담당 바꾸기 그대로(app.changeAssignee). handover = 「인수인계 기록도 남기기」 선택
 *  - doc: 초안 화면을 열고 보내는 사람 = 지금 담당, 받는 사람 = 새 담당, 대상 = 이 업무를 채우고 「담당도 넘기기」를 켜 둔다.
 *    날짜는 초안 규칙대로 오늘이다. 새 담당을 이름으로 넣었는데 이 지도에 없으면 사람을 먼저 만들어야 하므로 createPerson에 이름을 돌려준다.
 * @param {{branch:string, workGid:string, from:{gid:string,label:string}, toId?:string, toName?:string, persons:{id:string,gid:string,label:string}[]}} o
 * @returns {{ok:true, kind:'only', handoverOption:true}|{ok:true, kind:'doc', createPerson:string|null, preset:object, transfer:true, autoMake:true}|{ok:false, reason:'both'|'to-empty'|'ambiguous'|'same'}}
 */
export function transferBranchPlan(o) {
  const name = String(o.toName ?? '').trim();
  if (o.toId && name) return { ok: false, reason: 'both' };
  if (!o.toId && !name) return { ok: false, reason: 'to-empty' };
  if (o.branch !== BRANCH_DOC) return { ok: true, kind: 'only', handoverOption: true };
  let to = o.toId ? o.persons.find((p) => p.id === o.toId) : null;
  let createPerson = null;
  if (!to) {
    const hits = o.persons.filter((p) => normalizeLabel(p.label) === normalizeLabel(name));
    if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
    if (hits.length === 1) to = hits[0];
    else createPerson = name;
  }
  if (to && to.gid === o.from.gid) return { ok: false, reason: 'same' };
  return {
    ok: true,
    kind: 'doc',
    createPerson,
    preset: { target: o.workGid, from: o.from.label, from_gid: o.from.gid, to: to ? to.label : name, to_gid: to ? to.gid : '' },
    transfer: true,
    autoMake: true,
  };
}

// ── 3) 성공 알림 ──

/**
 * 성공 알림 하나의 문구와 「거기로 가기」 대상.
 * goto: {type:'history', nodeGid, gids}(그 업무를 골라 방금 기록한 이력 줄로) | {type:'node', nodeGid}(그 항목을 고름) | {type:'space', space}(공간으로) | null
 * @param {string} kind
 * @param {object} d
 * @returns {{testid:string, text:string, goto:object|null, long?:boolean}}
 */
export function successNotice(kind, d) {
  const history = (nodeGid, gids) => (nodeGid && gids && gids.length ? { type: 'history', nodeGid, gids } : null);
  const node = (nodeGid) => (nodeGid ? { type: 'node', nodeGid } : null);
  switch (kind) {
    case 'record': { // 「이번 주 기록」·카드의 「기록 남기기」(메모)
      const when = d.date && d.today && d.date !== d.today ? `(${d.date}) ` : '';
      return { testid: 'weekly-done', text: `「${d.label}」에 ${when}기록했습니다 — [${MEMO_CATEGORIES[d.category] || d.category}] ${d.note}`, goto: history(d.workGid, d.evGids) };
    }
    case 'record-past': // 이미 끝난 일(이슈 + 해결됨 두 건)
      return { testid: 'past-resolved-done', text: '이슈와 그것을 닫는 해결됨 메모를 함께 남겼습니다 — 미해결에 쌓이지 않습니다.', goto: history(d.workGid, d.evGids) };
    case 'record-event': // 메모가 아닌 기록(담당 시작·인수인계 등)
      return { testid: 'event-done', text: `「${d.label}」에 ${d.typeLabel || '이력'}을 기록했습니다.`, goto: history(d.workGid, d.evGids) };
    case 'resolve': {
      const name = d.label ? `「${d.label}」의 ` : '';
      return { testid: 'resolve-done', text: `${name}미해결 1건을 해결로 표시했습니다.`, goto: history(d.nodeGid, d.evGids) };
    }
    case 'assignee': {
      const when = d.when;
      return {
        testid: 'assignee-done',
        text: `「${d.work}」의 담당을 ${d.from} → ${d.to}${josa(d.to, '으로/로')} 바꿨습니다(${when}). ${d.from}의 수행은 ${when}에 끝나고 ${d.to}의 수행은 ${when}부터 시작됩니다.${d.created ? ` 「${d.to}」${josa(d.to, '은/는')} 새 사람으로 만들었습니다.` : ''}${d.handover ? ' 인수인계 기록도 남겼습니다.' : ''}`,
        goto: node(d.workGid),
      };
    }
    case 'collab':
      return { testid: 'collab-done', text: `「${d.name}」${josa(d.name, '을/를')} 이 업무의 협업자로 이었습니다(참조). ${d.extra}${d.exchange ? ` 주고받는 것(연결 메모): ${d.exchange}` : ''}`, goto: node(d.workGid) };
    case 'assign':
      return { testid: 'assign-done', text: `「${d.name}」${josa(d.name, '을/를')} 이 업무의 담당으로 넣었습니다${d.existing ? '' : ' (새 사람으로 만들었습니다)'}.`, goto: node(d.workGid) };
    case 'identity': // 통합 확인의 같은 사람/다른 사람(같은 업무/다른 업무) 판정
      return { testid: 'identity-done', text: `${d.a}와 ${d.b}${josa(d.b, '을/를')} ${d.same ? '같은' : '다른'} ${d.kind === 'work' ? '업무' : '사람'}으로 판정했습니다.`, goto: node(d.nodeGid) };
    case 'add-one': // 하나씩 추가
      return { testid: 'add-one-done', text: `${d.count > 1 ? `${d.count}개 추가` : '1개 추가'} · 「${d.label}」${d.extra ? ` ${d.extra}` : ''}`, goto: node(d.nodeGid), goLabel: d.core === 'work' ? '업무 보기' : '' };
    case 'table-add': // 표로 추가·글로 추가
      return { testid: 'table-add-done', text: `${d.count}개 추가${d.summary ? ` · ${d.summary}` : ''}`, goto: node(d.nodeGid), goLabel: d.core === 'work' ? '업무 보기' : '' };
    case 'table-edit':
      return { testid: 'table-add-done', text: d.summary || '표에서 고친 내용을 저장했습니다.', goto: node(d.nodeGid) };
    case 'import':
      return { testid: 'import-done', text: `가져왔습니다 — 「${d.name}」(항목 ${d.nodes}개)`, goto: null, long: true };
    case 'group':
      return { testid: 'group-done', text: d.text, goto: d.pending ? { type: 'space', space: 'edit', merge: true } : null, long: true, goLabel: d.pending ? '통합 확인' : '' };
    case 'confirm':
      return { testid: 'confirm-done', text: d.text, goto: node(d.nodeGid) };
    default:
      return { testid: (d && d.testid) || 'notice', text: String(d && d.text ? d.text : ''), goto: node(d && d.nodeGid) };
  }
}

// ── 4) 하나씩 추가 양식의 이름 칸 ──

/** 이름 칸(선택): 담당자·산출물·다음 업무. 업무를 추가할 때만 쓴다 */
export const EXTRA_NAME_KEYS = ['assignee', 'outputs', 'next'];
export const EXTRA_NAME_LABELS = { assignee: '담당자', outputs: '산출물', next: '다음 업무' };

/** 양식의 이름 칸 값을 정리: 업무가 아니거나 모두 비었으면 null */
export function extraNames(coreType, raw = {}) {
  if (coreType !== 'work') return null;
  const out = {};
  for (const k of EXTRA_NAME_KEYS) out[k] = String(raw[k] ?? '').trim();
  return EXTRA_NAME_KEYS.some((k) => out[k]) ? out : null;
}

/**
 * 하나씩 추가 양식이 저장할 묶음 명령. 이름 칸이 없으면 지금과 같다(노드 1행 + 함께 이을 연결 2행).
 * 이름 칸이 있으면 표로 추가의 한 행 처리(model/table.js newRowsToOps)를 그대로 써서 담당자·산출물·다음 업무를 같은 묶음에 만든다.
 * 노드 입력(설명·속성·기간 등)은 양식이 모은 값을 그대로 쓴다 — 표의 글 칸으로 되돌리지 않는다.
 * @param {{input:object, attachRoot:boolean, link?:{core_type:string, other_id:string, out:boolean}|null, names?:object|null, doc:object}} o
 * @returns {object[]} applyBatch 명령
 */
export function addNodeOps({ input, attachRoot, link = null, names = null, doc }) {
  const base = { op: 'addNode', row: 1, input, attachRoot: !!attachRoot };
  let ops = [base];
  if (names) {
    const table = newRowsToOps([{ line: 1, cells: { type: '업무', label: input.label, assignee: names.assignee, outputs: names.outputs, next: names.next } }], { doc, attachRoot: !!attachRoot });
    if (table[0] && table[0].op === 'addNode') ops = [{ ...table[0], input, attachRoot: !!attachRoot }, ...table.slice(1)];
    else if (table[0]) ops = [table[0]]; // 이름 칸 쪽 오류(여럿·너무 김 등): 그 행 오류를 그대로 돌려 아무것도 저장하지 않는다
  }
  if (link && ops[0].op === 'addNode') {
    ops.push({ op: 'addEdge', row: 2, input: { core_type: link.core_type, source: link.out ? '@1' : link.other_id, target: link.out ? link.other_id : '@1' } });
  }
  return ops;
}

/** 이름 칸으로 만든 것의 한 줄 요약(알림 끝에 붙임): 「담당 김가상 · 산출물 1 · 다음 업무 1」 */
export function extraSummary(names) {
  if (!names) return '';
  const parts = [];
  for (const k of EXTRA_NAME_KEYS) if (names[k]) parts.push(`${EXTRA_NAME_LABELS[k]} ${names[k]}`);
  return `(${parts.join(' · ')})`;
}

// ── 5) 묶은 직후 띠 ──

/**
 * 「업무 지도 묶기」 직후 띠: 같은 사람·업무 확인 건수. 확인할 것이 없으면 안내만(통합 확인으로 가는 단추 없음).
 * @param {{counts?:{pending:number, persons:number, works:number}}|null} plan app.mergePlan() 결과
 */
export function groupedStrip(plan, { name = '', auto = 0 } = {}) {
  const pending = plan && plan.counts ? plan.counts.pending : 0;
  const head = name ? `「${name}」${josa(name, '으로/로')} 묶었습니다` : '묶었습니다';
  const autoText = auto ? ` · 사번이 같은 사람 ${auto}명은 자동으로 이었습니다` : '';
  return pending
    ? { pending, text: `${head}${autoText} — 같은 사람·업무 확인 ${pending}건 → 통합 확인` }
    : { pending: 0, text: `${head}${autoText} — 확인할 같은 사람·업무는 없습니다` };
}

/** 통합 확인의 「사번 없음」 줄에서 사번을 바로 넣을 수 있는가: 그 사람이 있는 하위 지도가 이 브라우저 저장소에 있고 쓸 수 있을 때만 */
export function canInlineEmpNo(item, { readOnly, ownerDoc }) {
  if (readOnly || !item || item.type !== 'no_empno' || !ownerDoc) return false;
  return !ownerDoc.readOnly;
}
