// 문서를 Claude가 읽는 화면의 공통 조각: 「꼼꼼히 읽기」 체크, 단계별 대기 문구, 검토(두 번째 읽기) 요약.
// 쓰는 곳: 문서로 더하기(ui/doc-attach.js)와 가져오기의 「AI로 변환」(ui/import.js). DOM 만들기(el)만 쓰고 저장소·네트워크는 쓰지 않는다.
import { el } from './dom.js';

/** 화면 문구(한 곳) */
export const AI_READ = Object.freeze({
  reviewLabel: '꼼꼼히 읽기(두 번 읽어 빠진 것을 더함 — 시간·사용료 약 2배)',
  readStage: (review) => `Claude가 문서를 읽는 중…${review ? '(1/2)' : ''}`,
  reviewStage: '빠진 것이 없는지 다시 보는 중…(2/2)',
  maxTime: (review) => (review ? '최대 약 3분' : '최대 90초'),
  reviewTitle: '검토(두 번째 읽기)',
  reviewLine: (added, issues) => `${AI_READ.reviewTitle} — 더한 것 ${added}개 · 확인 필요 ${issues}건`,
  reviewFail: (reason) => `검토는 하지 못했습니다(${reason}) — 첫 읽기 결과입니다`,
  quoteLabel: '원문',
});

/** 대기 줄 문구: 단계 + 최대 시간. stage: 'read' | 'review' */
export function busyText(stage, review) {
  const head = stage === 'review' ? AI_READ.reviewStage : AI_READ.readStage(review);
  return `${head} — ${AI_READ.maxTime(review)}`;
}

/** 「꼼꼼히 읽기」 체크 상자(label로 감싼다). onChange(checked) */
export function reviewBox(testid, checked, onChange, disabled = false) {
  const box = el('input', { type: 'checkbox', 'data-testid': testid, checked: !!checked, disabled, onchange: (e) => onChange(e.target.checked) });
  const label = el('label', { class: 'check small', 'data-testid': `${testid}-label` }, box, ` ${AI_READ.reviewLabel}`);
  label.box = box; // 부르는 쪽이 읽는 동안 잠글 때 쓴다
  return label;
}

/**
 * 검토 결과 요약. review: convertDocumentAsync의 review(또는 keptToAttachPlan이 바꾼 {ok, added(숫자), issues}).
 * 검토를 하지 않았으면(null) 아무것도 그리지 않는다. issues는 펼치면 이유와 원문 구절이 보인다(open: 처음부터 펼침)
 */
export function reviewSummary(review, testid, { open = false } = {}) {
  if (!review) return null;
  if (!review.ok) return el('p', { class: 'muted small', 'data-testid': testid }, AI_READ.reviewFail(review.reason));
  const added = typeof review.added === 'number' ? review.added : (review.added ? review.added.nodes + review.added.edges + review.added.memos + review.added.attrs : 0);
  const issues = review.issues || [];
  if (!issues.length) return el('p', { class: 'muted small', 'data-testid': testid }, AI_READ.reviewLine(added, 0));
  return el('details', { class: 'ai-review', 'data-testid': testid, ...(open ? { open: true } : {}) },
    el('summary', { class: 'small' }, AI_READ.reviewLine(added, issues.length)),
    el('ul', {}, ...issues.map((i, k) => el('li', { class: 'small', 'data-testid': `${testid}-issue-${k}` }, `「${i.label}」 — ${i.reason}`, i.quote ? el('span', { class: 'muted' }, ` (${AI_READ.quoteLabel}: 「${i.quote}」)`) : null))));
}
