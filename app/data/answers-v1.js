// 정답 표 v1 (02-design 7절, 03-plan T-04). 규칙 기반 결과와 사전 생성 결과를 채점하는 기준이다.
// 근거 ID는 전역 참조("<유니버스 ID>/<노드 또는 이벤트 ID>")다. 평가 기준: ① 근거 ID 유효율 100%, ② 업무 후보에 정답 쌍 포함.
// status가 'pending'인 항목은 해당 작업에서 확정한다. 데이터가 바뀌면 이 표도 함께 고친다(K-9).

export const ANSWERS_V1 = {
  version: 'v1',
  data: ['app/data/sample-a1.js'],

  // R-03 인수인계 초안(D-09 8개 항목). 대상은 업무 유니버스, 보내는 사람 → 받는 사람
  handover_drafts: [
    {
      id: 'HD-A1-1',
      target: 'U-A1/N-000',
      from: 'U-A1/N-011', // 윤바다
      to: 'U-A1/N-012', // 서하늘
      items: {
        업무_개요: { evidence: ['U-A1/N-000'] },
        세부_업무_주기: { evidence: ['U-A1/N-001', 'U-A1/N-002', 'U-A1/N-003'] },
        선후행: { evidence: ['U-A1/N-001', 'U-A1/N-002', 'U-A1/N-003'] }, // 자료 수집 → 대사 확인 → 보고
        산출물: { evidence: ['U-A1/N-020', 'U-A1/N-021'] },
        // 보내는 사람(윤바다)은 제외. 받는 사람(서하늘)도 뺄지는 T-07에서 확정한다(5.6은 보내는 사람만 명시)
        관계자: { evidence: ['U-A1/N-010'], status: 'pending', decide_in: 'T-07' },
        최근_이슈: { evidence: ['U-A1/E-006'] }, // 2026-09 "대사 불일치 3건 재발"
        // 이번 인수인계(E-007)는 제외하고 이전 것만: 한가람 → 윤바다, 근거 산출물 2026-06 인수인계서
        이전_인수인계: { evidence: ['U-A1/E-002', 'U-A1/N-020'] },
        // 사례 2(U-B)가 있어야 결과가 나온다. 사례 1만 있으면 "이력 부족"이 맞다
        유사_경험자: { evidence: [], status: 'pending', decide_in: 'T-13', note: '사례 1 단독이면 이력 부족' },
      },
    },
  ],

  // R-05 반복 비효율(D-08 규칙 ①): 같은 업무에서 인수인계가 2회 이상이고, 이후 인수인계가 이전 인수인계서를 참조하지 않음
  repeat_inefficiency: [
    {
      id: 'RI-A1-1',
      work: 'U-A1/N-001',
      rule: '①',
      evidence: ['U-A1/E-002', 'U-A1/E-007'], // E-007에 previous_handover_id와 artifact_id가 없다
    },
  ],

  // R-05 유사 경험자: 사례 2 데이터(T-13)가 있어야 확정할 수 있다
  similar_experts: [
    {
      id: 'SE-1',
      work: 'U-A1/N-001',
      expected: ['윤바다(V-1002)'],
      status: 'pending',
      decide_in: 'T-13',
      note: '주제 "대사 불일치"를 공유하는 사례 2의 업무를 수행한 사람. 현재 담당자(서하늘)는 제외',
    },
  ],

  // R-11 같은 업무 쌍: A·B·C 데이터가 있어야 한다
  same_work_pairs: [],
};
