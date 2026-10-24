// 편집 되감기 화면(CR-14 A, R-25, D-30): 개요의 입구, 머리 띠, 오른쪽 패널(시점 막대·목록), 확인 문구.
// 문구는 이 모듈 안에 둔다. 데이터를 바꾸지 않는다 — 저장은 main.js가 app.rewindTo로 한다.
// 「시간 보기」(업무가 언제 누구 것이었나)와 다르다: 여기서는 지도가 언제 어떻게 고쳐졌는지(기록 시각)를 본다.

import { el } from './dom.js';
import { messageFor } from './messages.js';
import { eventTypeLabel } from '../model/schema.js';
import { pointLabel } from '../model/rewind.js';

const FIELD_NAMES = {
  label: '이름', description: '설명', attrs: '속성', tags: '태그', period: '기간', subtype: '하위 유형', emp_no: '사번',
  exposed: '위층에 드러내기', hidden: '숨김', note: '메모',
};

export const fieldName = (f) => FIELD_NAMES[f] || f;

/** 칸 값을 한 줄 글로(길면 줄임). 없으면 「(없음)」 */
export function valueText(v) {
  if (v === undefined || v === null || v === '') return '(없음)';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  const s = typeof v === 'string' ? v : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k}: ${x}`).join(' / ') : String(v);
  return s.length > 80 ? `${s.slice(0, 80)}…` : s;
}

/**
 * 시점 라벨 만들기(9차 검토 U9-8b). 기본은 분까지("2026-10-23 14:05")이고, 같은 분에 시점이 둘 이상이면 그 시점들만 초까지 보인다.
 * 초까지 같으면(밀리초만 다름) 오래된 순으로 " (2번째)" 같은 순번을 붙인다. 목록에 없는 시점은 분까지.
 * @param {{at:string}[]} points editPoints 결과(오래된 순)
 * @returns {(at:string)=>string}
 */
export function pointLabeler(points) {
  const list = Array.isArray(points) ? points : [];
  const byMinute = new Map();
  for (const p of list) byMinute.set(pointLabel(p.at), (byMinute.get(pointLabel(p.at)) || 0) + 1);
  const secLabel = (at) => {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(String(at));
    return m ? `${m[1]} ${m[2]}` : pointLabel(at);
  };
  const base = (at) => (byMinute.get(pointLabel(at)) > 1 ? secLabel(at) : pointLabel(at));
  const seen = new Map(); // 초까지 같은 라벨이 몇 번째인가
  const total = new Map();
  for (const p of list) total.set(base(p.at), (total.get(base(p.at)) || 0) + 1);
  const label = new Map();
  for (const p of list) {
    const b = base(p.at);
    const n = (seen.get(b) || 0) + 1;
    seen.set(b, n);
    label.set(p.at, total.get(b) > 1 ? `${b} (${n}번째)` : b);
  }
  return (at) => (label.has(at) ? label.get(at) : pointLabel(at));
}

/** 시점 한 줄: 「2026-10-23 14:05 · 바뀐 3건」. labelOf는 pointLabeler 결과(없으면 분까지) */
export const pointText = (p, labelOf = pointLabel) => `${labelOf(p.at)} · 바뀐 ${p.count}건`;

/** 시점의 바뀐 종류 요약: 「생성·수정·숨김」 */
export const kindsText = (p) => p.kinds.map(eventTypeLabel).join('·');

/** 띠의 숫자 문구 */
export function diffText(diff) {
  return `이 시점 뒤 생김 ${diff.added.length} · 바뀜 ${diff.changed.length} · 숨김 ${diff.hidden.length}`;
}

/** 한계 안내 문장들(limits 코드별). 항상 보이는 고정 한계 한 줄이 맨 앞에 온다 */
export function limitTexts(limits) {
  const out = ['「바로 삭제」한 항목과 하위 유형 추가는 기록이 남지 않아 여기에 보이지 않습니다.'];
  const n = (code) => limits.filter((l) => l.code === code).length;
  if (n('purged')) out.push(`「완전히 삭제」한 항목 ${n('purged')}개는 내용을 지웠으므로 「(삭제된 항목)」 자리표시로만 보입니다.`);
  if (n('identity_detail')) out.push('같은 사람·업무 판정의 점수·이유·판정자는 기록에 없어, 판정 상태만 그때로 보입니다.');
  return out;
}

/** 되돌리기 확인 문구. preview는 app.rewindPreview 결과 */
export function confirmText(preview, at, labelOf = pointLabel) {
  const c = preview.counts;
  const hidden = c.hide_nodes + c.hide_edges;
  const shown = c.restore_nodes + c.add_edges;
  const edited = c.update_nodes + c.update_edges;
  const lines = [`지도를 ${labelOf(at)} 시점으로 되돌립니다.`];
  lines.push(`- 그 뒤 생기거나 그때 숨겨져 있던 항목·연결 ${hidden}개는 숨겨집니다(지워지지 않습니다).`);
  lines.push(`- 그 뒤 숨긴 항목·연결 ${shown}개는 다시 보입니다.`);
  lines.push(`- 그 뒤 바뀐 내용 ${edited}건은 그때 값으로 돌아갑니다.`);
  const extra = c.hide_refs + c.add_refs + c.identity;
  if (extra) lines.push(`- 묶음·같은 사람 판정 ${extra}건도 그때 상태로 맞춥니다.`);
  const skipped = preview.limits.filter((l) => ['purged_skip', 'edge_end_hidden', 'identity_created_after'].includes(l.code)).length;
  if (skipped) lines.push('- 되살릴 수 없는 일부(완전히 삭제한 항목 등)는 그대로 둡니다.');
  lines.push('메모·인수인계·담당 같은 사용자 기록은 그대로 남습니다. 되돌린 기록도 이력에 남아, 다시 되감을 수 있습니다.');
  return lines.join('\n');
}

/** 되돌리기 실패 문구(아무것도 바뀌지 않았음을 함께 알린다) */
export function failText(error) {
  if (error && error.nothing) return '되돌릴 것이 없습니다. 지금 모습이 이 시점과 같습니다.';
  if (error && error.reason === 'grouped') return '다른 업무 지도를 묶은 지도는 되감지 않습니다. 하위 업무 지도를 열어 되감으세요.';
  if (error && error.reason === 'rewinding') return '되감기 중에는 고칠 수 없습니다.';
  return `되돌리지 못했습니다. 아무것도 바뀌지 않았습니다. ${messageFor(error)}`;
}

/** 되돌린 뒤 알림 */
// skipped: 묶음 안에서 건너뛴 명령 수(이름이 겹쳐 되살리지 못한 노드, 끝 노드를 되살리지 못한 연결, 묶기·통합 판정). 사용자가 모르고 지나가지 않게 알린다(재검증)
export const doneText = (at, counts, skipped = 0, labelOf = pointLabel) => {
  const hidden = counts.hide_nodes + counts.hide_edges;
  const shown = counts.restore_nodes + counts.add_edges;
  const edited = counts.update_nodes + counts.update_edges;
  const skip = skipped ? ` 다만 ${skipped}건은 이름이 겹치거나 연결의 끝이 없어 되돌리지 못하고 그대로 두었습니다.` : '';
  return `${labelOf(at)} 시점으로 되돌렸습니다 — 숨김 ${hidden} · 다시 보임 ${shown} · 값 되돌림 ${edited}.${skip} 이력에 「편집 되감기」로 남았고, 다시 되감을 수도 있습니다.`;
};

/** 되돌릴 수 없는 이유(없으면 ''). baseReadOnly: 저장소·형식·내용 포함 HTML, nothing: 되돌릴 것이 없음 */
export function revertBlock({ baseReadOnly, nothing }) {
  if (baseReadOnly) return '읽기 전용이라 보기만 할 수 있습니다. 되돌리려면 이 업무 지도를 쓸 수 있는 상태(내 업무 지도)에서 여세요.';
  if (nothing) return '되돌릴 것이 없습니다. 지금 모습이 이 시점과 같습니다.';
  return '';
}

/** 개요의 입구. 시점이 2개 미만이면 단추를 막고 안내한다 */
export function rewindEntry({ points, onOpen }) {
  const enough = points.length >= 2;
  return el('div', { class: 'rewind-entry', 'data-testid': 'rewind-entry' },
    el('div', { class: 'row' },
      el('button', { type: 'button', 'data-testid': 'btn-rewind', disabled: !enough, onclick: onOpen, title: '지도가 언제 어떻게 고쳐졌는지 시점을 골라, 그때 모습을 읽기 전용으로 보고 필요하면 되돌립니다' }, '편집 되감기')),
    el('p', { class: 'muted small', 'data-testid': 'rewind-hint' }, enough
      ? '고친 시점을 골라 그때의 지도를 봅니다(읽기 전용). 업무가 언제 누구 것이었나를 보는 「시간 보기」와 다릅니다.'
      : '고친 기록이 아직 없습니다. 항목을 고치거나 추가하면 그 시점이 생겨, 나중에 되감을 수 있습니다.'));
}

/** 머리 띠(그래프 위). 같은 요소를 다시 채운다 */
export function fillBand(band, { at, diff, canRevert, reason, onRevert, onBack, labelOf = pointLabel }) {
  band.hidden = false;
  // replaceChildren(…, null)은 "null" 글자를 넣으므로 빈 값을 거른다(HANDOFF 4절)
  band.replaceChildren(...[
    el('span', { class: 'rewind-title', 'data-testid': 'rewind-title' }, `편집 되감기 중 — ${labelOf(at)} (읽기 전용)`),
    el('span', { class: 'rewind-counts', 'data-testid': 'rewind-counts' }, diffText(diff)),
    el('span', { class: 'rewind-actions' },
      el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-rewind-revert', disabled: !canRevert, title: canRevert ? '' : reason, onclick: onRevert }, '이 시점으로 되돌리기'),
      el('button', { type: 'button', 'data-testid': 'btn-rewind-back', onclick: onBack }, '지금으로 돌아가기')),
    reason ? el('span', { class: 'rewind-reason muted small', 'data-testid': 'rewind-reason' }, reason) : null,
  ].filter(Boolean));
}

export function hideBand(band) {
  band.hidden = true;
  band.replaceChildren();
}

/**
 * 오른쪽 패널(아무것도 고르지 않았을 때): 시점 막대·목록·요약·지금과 다른 노드 목록.
 * @param {{points:object[], at:string, diff:object, limits:object[], labelOf:(id:string)=>string, timeLabel?:(at:string)=>string, isNode:(id:string)=>boolean, gidOf:(id:string)=>string, onPick:(at:string)=>void, onSelect:(gid:string)=>void}} o
 */
export function rewindPanel(o) {
  const timeLabel = o.timeLabel || pointLabeler(o.points);
  const idx = Math.max(0, o.points.findIndex((p) => p.at === o.at));
  const bar = el('input', { type: 'range', min: '0', max: String(o.points.length - 1), step: '1', value: String(idx), class: 'rewind-bar', 'data-testid': 'rewind-bar', 'aria-label': '되감기 시점 막대(왼쪽이 오래된 시점)' });
  bar.addEventListener('input', () => o.onPick(o.points[Number(bar.value)].at));
  const list = el('ul', { class: 'rewind-points', 'data-testid': 'rewind-points' });
  [...o.points].reverse().forEach((p, k) => {
    const chosen = p.at === o.at;
    list.append(el('li', {},
      el('button', { type: 'button', class: 'rewind-point', 'data-testid': 'rewind-point', 'data-at': p.at, 'aria-pressed': String(chosen), onclick: () => o.onPick(p.at) },
        pointText(p, timeLabel), k === 0 ? ' (가장 최근)' : '', el('span', { class: 'muted small' }, ` ${kindsText(p)}`))));
  });
  const nodeChanges = [
    ...o.diff.changed.filter((c) => c.kind === 'node').map((c) => ({ id: c.id, note: `바뀜: ${c.fields.map(fieldName).join('·')}` })),
    ...o.diff.hidden.filter((id) => o.isNode(id)).map((id) => ({ id, note: '이 시점 뒤 숨김' })),
  ];
  const changed = el('ul', { class: 'rewind-changed', 'data-testid': 'rewind-changed' },
    ...nodeChanges.slice(0, 30).map((c) => el('li', {}, el('button', { type: 'button', class: 'link', onclick: () => o.onSelect(o.gidOf(c.id)) }, o.labelOf(c.id) || c.id), el('span', { class: 'muted small' }, ` — ${c.note}`))));
  return el('div', { 'data-testid': 'rewind-panel' },
    el('h2', {}, '편집 되감기'),
    el('p', { class: 'muted small' }, '시점을 고르면 그때의 지도를 읽기 전용으로 그립니다. 주황 테두리는 지금과 달라진 항목입니다. 항목을 누르면 그때 값이 보입니다.'),
    el('label', { class: 'rewind-bar-label' }, '시점 막대 ', bar),
    el('p', { class: 'rewind-now', 'data-testid': 'rewind-now' }, `고른 시점: ${timeLabel(o.at)}`),
    el('p', { class: 'rewind-summary', 'data-testid': 'rewind-summary' }, diffText(o.diff)),
    nodeChanges.length ? el('div', {}, el('h3', {}, '지금과 다른 항목'), changed) : null,
    el('h3', {}, '고친 시점'),
    list,
    ...limitTexts(o.limits).map((t) => el('p', { class: 'muted small', 'data-testid': 'rewind-limit' }, t)),
  );
}

/** 노드 상세 위에 붙이는 「지금과 다른 칸」 안내. change가 없으면 null */
export function nodeChangeNote({ change, pastNode, currentNode }) {
  if (!change) return null;
  const rows = change.fields.map((f) => {
    const then = f === 'hidden' ? (pastNode.hidden ? '숨겨져 있었음' : '보였음') : valueText(pastNode[f]);
    const now = currentNode ? (f === 'hidden' ? (currentNode.hidden ? '숨김' : '보임') : valueText(currentNode[f])) : '(없음)';
    return el('li', {}, el('b', {}, fieldName(f)), ` — 그때 ${then} / 지금 ${now}`);
  });
  return el('div', { class: 'notice', 'data-testid': 'rewind-node-note' }, '이 시점의 값입니다. 지금과 다른 칸:', el('ul', {}, ...rows));
}
