// 사전 생성(CR-1, T-12) 대상 시나리오. 시연 흐름에서 보이는 초안·인사이트 설명이다.
// tools/pregen-dump.mjs(작성용 근거 덤프)와 tests/pregen.test.js(낡은 결과 검사)가 함께 쓴다.
// 화면과 같은 규칙 함수로 규칙 기반 결과를 만들어, 사전 생성 결과의 조회 키가 화면에서도 맞도록 한다.
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft, scopeWorks } from '../app/src/rules/handover.js';
import { densityGaps, repeatInefficiency, similarExperts, similarSentences, DENSE_DEFAULT_N } from '../app/src/rules/insight.js';
import { flowChange } from '../app/src/rules/flow.js';
import { densityExplain, flowExplain, repeatExplain, similarExplain } from '../app/src/rules/explain.js';

export const PREGEN_ASOF = '2026-10-02';
const all = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
export const viewOf = (id) => buildView(all[id], (x) => all[x] || null);

export const HANDOVER_SCENARIOS = [
  { id: 'H1', view: 'U-A1', target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', note: '월말 정산(시연 기본): 윤바다 → 서하늘' },
  { id: 'H2', view: 'U-D1', target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', note: '같은 초안을 부서 화면에서(유사 경험자가 채워짐)' },
  { id: 'H3', view: 'U-C', target: 'U-C/N-101', from: 'U-C/N-202', to: 'U-C/N-201', note: '교육팀 신입 교육 운영: 이든빛 → 나래솔' },
];

export const EXPLAIN_SCENARIOS = [
  { id: 'X1', kind: 'similar', view: 'U-D1', work: 'U-A1/N-001' },
  { id: 'X2', kind: 'repeat', view: 'U-A1' },
  { id: 'X3', kind: 'repeat', view: 'U-D1' },
  { id: 'X4', kind: 'density', view: 'U-D1' },
  { id: 'X5', kind: 'density', view: 'U-C' },
  { id: 'X6', kind: 'flow', view: 'U-A1' },
  { id: 'X7', kind: 'flow', view: 'U-O' },
];

/** 초안 시나리오의 규칙 기반 초안(화면 draft.js와 같은 계산) */
export function handoverDraftOf(s, asOf = PREGEN_ASOF) {
  const v = viewOf(s.view);
  // 화면(ui/draft.js)과 같게: 받는 사람·보내는 사람 제외(D3-31), 기준일 전달(검토5 I-1·I-8)
  const similar = similarSentences(similarExperts(v, { works: scopeWorks(v, s.target), asOf, exclude: [s.to, s.from] }));
  return { view: v, draft: buildHandoverDraft(v, { target: s.target, from: s.from, to: s.to, asOf, similar }).draft };
}

/** 설명 시나리오의 설명 요청(화면 insight.js와 같은 계산) */
export function explainRequestOf(s, asOf = PREGEN_ASOF) {
  const v = viewOf(s.view);
  if (s.kind === 'similar') return { view: v, req: similarExplain(similarExperts(v, { works: [s.work], asOf }), s.work) };
  if (s.kind === 'repeat') return { view: v, req: repeatExplain(repeatInefficiency(v, { asOf }), s.view) }; // 화면과 같이 기준일(검토5 I-2)
  if (s.kind === 'density') return { view: v, req: densityExplain(densityGaps(v, { asOf, n: DENSE_DEFAULT_N }), s.view) };
  return { view: v, req: flowExplain(flowChange(v, { unit: 'month', asOf }), s.view) };
}

// 역할 (c) 업무 후보 이유(T-10): 통합 화면의 업무 후보. 조회 키는 work_candidate|정렬한 두 노드
import { mergePlan } from '../app/src/merge/merge.js';
export const CANDIDATE_VIEWS = ['U-D1', 'U-T1'];
export function candidateRequestsOf(viewId) {
  const v = viewOf(viewId);
  const doc = SAMPLES.find((d) => d.universe.id === viewId);
  return { view: v, reqs: mergePlan(v, doc.identity_links).works.map((w) => ({ task: 'work_candidate_reason', target: `work_candidate|${[w.a, w.b].sort().join('|')}`, evidence_ids: w.evidence_ids, rule: [{ text: w.reason, evidence_ids: w.evidence_ids }], title: w.title })) };
}
