// 「처음 할 일」 상자(조력자 의견 2026-10-17 "어떻게 시작할지 막막하다"): 새로 만든 유니버스가 다음에 무엇을 하면 좋은지 3단계로 알린다.
// 내장 샘플과 하위 유니버스를 묶은 유니버스, 업무가 아직 없는 유니버스(기존 빈 유니버스 안내가 있다)에는 쓰지 않는다. 막지 않는다.
// DOM·저장소를 쓰지 않는다.
import { workFormMissing } from './form.js';

/**
 * @param {object} doc 현재 유니버스 문서
 * @param {object} view buildView 결과
 * @returns {{steps:{key:string, label:string, done:boolean, work?:{gid:string,label:string}}[]}|null} 보일 것이 없으면 null
 */
export function starterSteps(doc, view) {
  if (doc.universe.is_sample) return null;
  if ((doc.refs || []).some((r) => !r.hidden)) return null;
  const works = view.nodes.filter((n) => n.core_type === 'work' && !n.hidden);
  if (works.length === 0) return null;
  const steps = [
    {
      key: 'memo',
      label: `하늘색 업무 「${works[0].label}」을 누르고 「이력 추가」 → 메모로 주의사항·이슈 한 줄 남기기`,
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
      label: '업무 더 넣기(「노드 추가」 또는 「표로 추가」)',
      done: works.length >= 2,
    },
  ];
  return steps.every((s) => s.done) ? null : { steps };
}
