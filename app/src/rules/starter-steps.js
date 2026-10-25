// 「처음 할 일」 상자(조력자 의견 2026-10-17 "어떻게 시작할지 막막하다"): 새로 만든 유니버스가 다음에 무엇을 하면 좋은지 3단계로 알린다.
// 내장 샘플과 하위 유니버스를 묶은 유니버스, 업무가 아직 없는 유니버스(기존 빈 유니버스 안내가 있다)에는 쓰지 않는다. 막지 않는다.
// DOM·저장소를 쓰지 않는다.
import { workFormMissing } from './form.js';
import { PREGEN } from '../../data/pregen.js';
import { buildView } from '../view/view.js';

/**
 * @param {object} doc 현재 유니버스 문서
 * @param {object} view buildView 결과
 * @returns {{steps:{key:string, label:string, done:boolean, space?:string, work?:{gid:string,label:string}}[]}|null} space: 누르면 갈 작업 공간(없으면 글자만) 보일 것이 없으면 null
 */
export function starterSteps(doc, view) {
  if (doc.universe.is_sample) return null;
  if ((doc.refs || []).some((r) => !r.hidden)) return null;
  const works = view.nodes.filter((n) => n.core_type === 'work' && !n.hidden);
  if (works.length === 0) return null;
  const steps = [
    {
      key: 'memo',
      // 지금 화면 이름으로(CR-22 W): 왼쪽 「기록」 공간의 「이번 주 기록」. 줄을 누르면 그 공간으로 간다(space)
      label: `「기록」 공간에서 업무 「${works[0].label}」에 주의사항·이슈 한 줄 남기기`,
      space: 'record',
      work: { gid: works[0].gid, label: works[0].label },
      done: doc.events.some((e) => e.type === 'memo'),
    },
    {
      key: 'form',
      label: '업무의 권장 항목 채우기(설명·절차·주의사항 등)',
      done: works.every((n) => (workFormMissing(view, n.gid) || []).length === 0),
    },
    {
      key: 'more',
      label: '업무 더 넣기(「지도 관리」 공간의 「사람·업무·문서 추가」 또는 「표로 추가」)',
      space: 'edit',
      done: works.length >= 2,
    },
  ];
  return steps.every((s) => s.done) ? null : { steps };
}

// ── 빈 출발 미리 보기(CR-16 ③, 2026-10-23) ──
// 「처음 할 일」이 보이는 동안만, 월말 정산 샘플의 사전 생성 초안 한 토막을 「샘플」로 밝혀 보여 준다.
// 새 문장을 만들지 않는다: 문장은 사전 생성 결과(data/pregen.js)에서 글자 그대로 가져온다(지문·사전 생성 파일은 건드리지 않음).

// 어느 사전 생성 초안에서 어느 항목을 가져오는가. first=true면 첫 문장만
export const PREVIEW_SOURCE = { task: 'handover', target: 'U-A1/N-000' };
export const PREVIEW_ITEMS = [
  { key: '업무_개요', title: '업무 개요', first: false },
  { key: '세부_업무_절차', title: '세부 업무 절차', first: true },
  { key: '주의사항', title: '주의사항·노하우', first: false },
];
export const PREVIEW_TEXT = {
  summary: '기록이 이렇게 쌓이면 →',
  head: '샘플 「월말 정산 점검」에서 만든 인수인계 초안의 일부입니다(미리 쓴 문장, 가상 데이터)',
  chip: '샘플',
  risk: '인수인계 위험: 한 사람만 해 봤고 인수인계 기록이 없는 업무를 「높음」으로 알려 줍니다',
  note: '지금 지도에서 만들려면: 담당 이력과 메모를 쌓은 뒤 왼쪽 「인수인계」의 「인수인계 초안 만들기」',
};

/** 미리 보기 내용. 사전 생성 항목이 없으면(낡음) 그 항목은 뺀다 */
export function previewContent() {
  const items = PREVIEW_ITEMS.map((spec) => {
    const hit = PREGEN.items.find((it) => it.task === PREVIEW_SOURCE.task && it.target === PREVIEW_SOURCE.target && it.item === spec.key);
    if (!hit || !hit.sentences.length) return null;
    const sentences = spec.first ? hit.sentences.slice(0, 1) : hit.sentences;
    return { key: spec.key, title: spec.title, text: sentences.map((s) => s.text).join(' ') };
  }).filter(Boolean);
  return { summary: PREVIEW_TEXT.summary, head: PREVIEW_TEXT.head, chip: PREVIEW_TEXT.chip, items, risk: PREVIEW_TEXT.risk, note: PREVIEW_TEXT.note };
}

/**
 * 「처음 할 일」이 남아 있을 때만 미리 보기 내용을, 아니면 null(샘플·묶음·업무 없음·다 한 경우 포함).
 * @param {object} doc 현재 유니버스 문서
 * @param {object} [view] buildView 결과(없으면 doc로 만든다)
 */
export function starterPreview(doc, view) {
  return starterSteps(doc, view || buildView(doc, () => null)) ? previewContent() : null;
}
