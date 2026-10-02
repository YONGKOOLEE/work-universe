// LLM 공급자(D-07 5.4, R-15, CR-1). 화면·기능 코드는 connector.js의 계약만 쓰고, 공급자는 이름으로 고른다.
//   none      — 규칙 기반 그대로
//   pregen    — 사전 생성(기본, CR-1): 개발 중 Claude Code가 작성한 결과(app/data/pregen.js, 12.3)를 조회 키로 찾는다
//   claude_api, internal — P2(1차 제출 범위 밖). 고르면 이유를 알리고 규칙 기반으로 돌아간다
//   fail      — 점검용 "실패 흉내"(R-04 ③): 호출 실패를 흉내 내 규칙 기반 전환을 보여 준다
// 브라우저 기능을 쓰지 않는다(12.7).

export const PROVIDERS = [
  { name: 'pregen', label: '사전 생성(개발 시 Claude로 작성)', help: '기본값. 개발 중 Claude로 미리 작성한 문장을 씁니다. 결과가 없거나 데이터가 바뀐 항목은 규칙 기반 문장으로 보입니다.' },
  { name: 'none', label: '규칙 기반만', help: '기록을 규칙으로 옮겨 적은 문장만 씁니다(LLM 없음).' },
  { name: 'claude_api', label: 'Claude API (P2, 1차 제출 범위 밖)', help: '1차 제출물에는 연결하지 않았습니다. 고르면 규칙 기반으로 동작하고 이유를 표시합니다.' },
  { name: 'internal', label: '사내 LLM (P2)', help: '사용 방법이 정해지면 이 자리에 연결합니다. 지금은 규칙 기반으로 동작합니다.' },
  { name: 'fail', label: '실패 흉내(점검용)', help: 'LLM 호출이 실패한 상황을 흉내 냅니다. 규칙 기반으로 바뀌고 원인이 표시되는지 확인할 때 씁니다(R-04 ③).' },
];
export const DEFAULT_PROVIDER = 'pregen';

const sortedIds = (ids) => [...new Set(ids)].sort();
/**
 * 사전 생성 조회 키(12.3): 작업, 대상, (초안이면) 항목·보내는 사람>받는 사람, 정렬한 근거 ID.
 * 초안은 사람에 따라 문장(문의할 사람 등)이 달라지므로 보내는·받는 사람이 같을 때만 쓴다(검토3 LLM-1)
 */
export function pregenKey(task, target, item, evidenceIds, people = '') {
  return [task, target, item || '', people, sortedIds(evidenceIds).join(',')].join('|');
}
export const peopleKey = (from, to) => (from && to ? `${from}>${to}` : '');

/** 규칙 기반 초안 항목의 근거 ID 전체 */
export const itemEvidence = (item) => sortedIds(item.sentences.flatMap((s) => s.evidence_ids));

function pregenProvider(file) {
  const index = new Map();
  for (const it of (file && Array.isArray(file.items) ? file.items : [])) {
    if (!it || !Array.isArray(it.evidence_ids) || !Array.isArray(it.sentences)) continue; // 깨진 줄은 건너뛴다
    index.set(pregenKey(it.task, it.target, it.item, it.evidence_ids, peopleKey(it.from, it.to)), it);
  }
  return {
    name: 'pregen',
    method: 'pregen',
    // 초안: 항목마다 키가 맞는 결과만 돌려준다. 맞지 않는 항목(새 데이터·바뀐 근거)은 빠지고 규칙 기반이 남는다(K-9)
    refine(task, draft) {
      const items = [];
      for (const item of draft.items) {
        if (item.insufficient) continue;
        const hit = index.get(pregenKey(task, draft.target, item.key, itemEvidence(item), peopleKey(draft.from, draft.to)));
        if (hit) items.push({ key: item.key, sentences: hit.sentences });
      }
      return { items };
    },
    // 설명(인사이트 설명 insight_explain, 업무 후보 이유 work_candidate_reason): 대상과 근거가 맞으면 문장, 아니면 null
    explain(target, evidenceIds, task = 'insight_explain') {
      const hit = index.get(pregenKey(task, target, '', evidenceIds));
      return hit ? { sentences: hit.sentences } : null;
    },
  };
}

function unavailable(name, reason) {
  const fail = () => {
    throw new Error(reason);
  };
  return { name, method: 'llm', refine: fail, explain: fail };
}

/**
 * @param {string} name 공급자 이름
 * @param {{pregen?: object}} deps pregen: 사전 생성 결과 파일 내용
 * @returns {object|null} null이면 규칙 기반(none)
 */
export function createProvider(name, { pregen } = {}) {
  switch (name) {
    case 'none':
      return null;
    case 'claude_api':
      return unavailable(name, 'Claude API 연결은 1차 제출 범위 밖(P2)이라 연결하지 않았습니다');
    case 'internal':
      return unavailable(name, '사내 LLM은 사용 방법이 정해지지 않아 연결하지 않았습니다(P2)');
    case 'fail':
      return unavailable(name, '호출 실패(점검용 흉내)');
    case 'pregen':
    default:
      return pregenProvider(pregen);
  }
}
