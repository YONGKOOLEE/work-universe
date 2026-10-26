// 작업 공간(CR-22 W): 왼쪽 메뉴 5개의 이름·설명, 공간 전환 상태 규칙, 공간별 패널 구성, 배지, 인수인계 공간의 목록 계산.
// 화면(DOM)·저장소를 쓰지 않는다. 새 판정을 만들지 않는다 — 목록은 인사이트 탭이 쓰는 계산(rules/insight*.js)을 그대로 부르고 자르기만 한다.

import { knowledgeConcentration } from '../rules/insight-risk.js';
import { densityGaps } from '../rules/insight.js';
import { SUBTYPE_HANDOVER_DOC } from '../model/schema.js';

// 바꾸기 쉬운 값은 한 곳에(연속 진행 모드 원칙)
export const WORKSPACE = {
  LIST_MAX: 5, // 인수인계·매주 점검 공간의 목록 상한(담당 공백 업무·혼자만 아는 일)
  DOCS_MAX: 3, // 「최근 확정한 인수인계서」 건수
};

/** 공간 5개(순서 = 메뉴 순서). testid는 메뉴 단추 이름이다 */
export const WORKSPACES = [
  { key: 'map', label: '지도 보기', testid: 'ws-map', desc: '업무·사람·문서가 이어진 지도를 둘러봅니다. 도형을 누르면 그 항목의 내용·연결·기록이 오른쪽에 보입니다' },
  { key: 'record', label: '기록', testid: 'ws-record', desc: '업무에 메모·진행 상황을 남기고, 끝난 일을 해결로 표시합니다' },
  { key: 'handover', label: '인수인계', testid: 'ws-handover', desc: '담당자가 바뀔 때 넘겨줄 글(초안)을 기록에서 만들고 확정합니다' },
  { key: 'check', label: '매주 점검', testid: 'ws-check', desc: '혼자만 아는 일·일 몰린 사람·담당 없는 업무를 보고, 팀·부서로 묶은 지도는 점검을 저장해 지난번과 비교합니다' },
  { key: 'edit', label: '지도 관리', testid: 'ws-edit', desc: '항목을 더하고 고치고, 지도를 만들고 묶고 내보내고, 이전 모습으로 되돌립니다' },
];
export const WORKSPACE_KEYS = WORKSPACES.map((w) => w.key);
export const DEFAULT_WORKSPACE = 'map';
export const isWorkspace = (v) => typeof v === 'string' && WORKSPACE_KEYS.includes(v);
/** 설정에서 읽은 값을 바로잡는다: 모르는 값이면 기본(지도 보기) */
export const cleanWorkspace = (v) => (isWorkspace(v) ? v : DEFAULT_WORKSPACE);
export const workspaceOf = (key) => WORKSPACES.find((w) => w.key === key) || WORKSPACES[0];

// ── 상태 규칙 ──
/** 열 수 있는 작업 화면(초안·인사이트·통합 확인·미해결 목록·설정·되감기·숨긴 항목) */
export const WORK_SCREENS = ['draft', 'insight', 'merge', 'issues', 'settings', 'rewind', 'hidden'];

/** 작업 화면을 열면 메뉴가 따라 바뀌는 공간. 설정은 어느 공간에서든 열려 공간을 바꾸지 않는다(null) */
const SCREEN_SPACE = { draft: 'handover', insight: 'check', merge: 'edit', rewind: 'edit', issues: 'record', hidden: 'edit', settings: null };
export function spaceForScreen(screen) {
  return Object.prototype.hasOwnProperty.call(SCREEN_SPACE, screen) ? SCREEN_SPACE[screen] : null;
}

/**
 * 메뉴로 공간을 고를 때의 계획. 열린 작업 화면은 닫는다(closeScreens). 항목 카드도 닫고 공간 첫 화면을 보인다 —
 * R11 FU6-1(2026-10-26): 카드를 둔 채 메뉴 강조만 바뀌면 「메뉴가 안 먹는다」로 보여, 예전의 「카드 유지 + 관련 위치 스크롤」 규칙을 없앴다.
 * 카드를 둔 채 공간을 바꾸는 호출(기능 찾기·따라 하기)은 부르는 쪽이 keepCard로 따로 정한다.
 * @param {{to:string, open:string[]}} o open: 지금 열려 있는 작업 화면 이름들
 * @returns {{space:string, closeScreens:string[]}}
 */
export function planSwitch({ to, open = [] }) {
  return {
    space: cleanWorkspace(to),
    closeScreens: WORK_SCREENS.filter((s) => open.includes(s)),
  };
}

/** 작업 화면이 열려 있으면 그 화면이 속한 공간(여럿이면 앞에 둔 것), 아니면 현재 공간 그대로 */
export function followScreens(current, open) {
  for (const s of WORK_SCREENS) {
    if (!open.includes(s)) continue;
    const sp = spaceForScreen(s);
    if (sp) return sp;
  }
  return cleanWorkspace(current);
}

/** 메뉴 숫자 배지: 기록 = 미해결 수, 매주 점검 = 혼자만 아는 일 수. 0이거나 셀 수 없으면(null) 배지 없음 */
export function spaceBadges({ issues, solo }) {
  const n = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  return { map: null, record: n(issues), handover: null, check: n(solo), edit: null };
}

// ── 공간별 패널 구성 ──
/**
 * 아무 항목도 고르지 않았을 때 공간 패널이 위에서부터 보여 줄 조각의 이름(순서가 화면 순서).
 * @param {string} space
 * @param {{grouped:boolean, readOnly:boolean, rewinding:boolean, starter:boolean, split:boolean, empty:boolean, folder:boolean, conflicts:boolean, stale:boolean}} c
 */
export function panelParts(space, c) {
  switch (cleanWorkspace(space)) {
    case 'record':
      return ['issues', ...(c.readOnly || c.rewinding ? [] : ['weekly']), 'recent'];
    case 'handover':
      return ['draft', ...(c.readOnly ? [] : ['assignee-hint']), 'gaps', 'solo', 'docs'];
    case 'check':
      // 묶은 지도: 위험 요약 + 혼자만 아는 일 상위 목록(이름 → 카드, 인수인계 공간과 같은 계산, R12 FU7-2) + 통합 확인 대기 바로가기(FU7-12, 대기가 있을 때만)
      return c.grouped ? ['risk', 'solo', 'merge-link', 'insight'] : ['map-risk', 'group-hint', 'insight'];
    case 'edit':
      return [
        ...(c.readOnly ? [] : ['add-open']),
        'admin', 'rewind', 'hidden',
        ...(c.grouped ? ['merge'] : []),
        ...(c.folder ? ['folder'] : []),
        ...(c.conflicts ? ['conflicts'] : []),
        ...(c.stale ? ['stale'] : []),
      ];
    default:
      return ['summary', ...(c.split ? ['split'] : []), ...(c.starter ? ['starter'] : []), 'intro', 'help'];
  }
}

// ── 인수인계·매주 점검 공간의 목록(기존 계산 재사용) ──
const gapText = (g) => (g.kind === 'ended' && g.last_person ? `이전 담당 ${g.last_person.label}(${g.last_end}까지)`
  : g.kind === 'scheduled' && g.next_person ? `시작 예정 ${g.next_person.label}(${g.next_start}부터)`
    : '담당 기록 없음');

/**
 * 담당 공백 업무(밀집·공백 탭의 「담당자 빈 일」과 같은 계산) 상위 max개.
 * @returns {{status:string, total:number|null, rows:{gid:string,label:string,text:string}[]}} total이 null이면 셀 수 없음(담당 기록 부족)
 */
export function gapWorkRows(view, { asOf, n, max = WORKSPACE.LIST_MAX }) {
  const d = densityGaps(view, { asOf, n });
  if (d.status === 'insufficient') return { status: 'insufficient', total: null, rows: [] };
  return { status: d.status, total: d.gaps.length, rows: d.gaps.slice(0, max).map((g) => ({ gid: g.gid, label: g.label, text: gapText(g) })) };
}

/** 일이 몰린 사람(밀집·공백 탭의 「일 몰린 사람」과 같은 계산) 상위 max명 */
export function denseRows(view, { asOf, n, max = WORKSPACE.LIST_MAX }) {
  const d = densityGaps(view, { asOf, n });
  if (d.status === 'insufficient') return { status: 'insufficient', total: null, rows: [] };
  return { status: d.status, total: d.dense.length, rows: d.dense.slice(0, max).map((p) => ({ gid: p.gid, label: p.label, count: p.count })) };
}

const LEVEL_TEXT = { high: '인수인계 기록 없음', caution: '인수인계 기록 있음' };
/**
 * 혼자만 아는 일(인수인계 위험 탭 ①과 같은 계산, 높음이 먼저) 상위 max개.
 * @returns {{status:string, total:number|null, rows:{work_gid:string,work:string,person_gid:string,person:string,level:string,text:string}[]}}
 */
export function soloRows(view, { asOf, max = WORKSPACE.LIST_MAX }) {
  const c = knowledgeConcentration(view, { asOf });
  if (c.insufficient) return { status: 'insufficient', total: null, rows: [] };
  return {
    status: c.status,
    total: c.items.length,
    rows: c.items.slice(0, max).map((x) => ({ work_gid: x.work.gid, work: x.work.label, person_gid: x.person.gid, person: x.person.label, level: x.level, text: LEVEL_TEXT[x.level] })),
  };
}

const day = (s) => (/^\d{4}-\d{2}-\d{2}/.exec(String(s || '')) || [''])[0];
/**
 * 최근 확정한 인수인계서(산출물 「인수인계서」) max개. 확정 시각(없으면 이름 앞의 날짜)이 늦은 순.
 * @returns {{gid:string,label:string,date:string}[]}
 */
export function recentHandoverDocs(view, max = WORKSPACE.DOCS_MAX) {
  const rows = view.nodes
    .filter((n) => n.core_type === 'artifact' && n.subtype === SUBTYPE_HANDOVER_DOC && !n.hidden && !n.deleted)
    .map((n) => {
      const a = n.attrs || {};
      const stamp = String(a['확정 시각'] || '');
      return { gid: n.gid, label: n.label, date: day(stamp) || day(n.label), stamp: stamp || day(n.label) };
    });
  rows.sort((a, b) => (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : a.gid < b.gid ? 1 : -1));
  return rows.slice(0, max).map(({ gid, label, date }) => ({ gid, label, date }));
}
