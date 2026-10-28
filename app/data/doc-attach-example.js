// 문서로 더하기(CR-23)의 「예시 문서 넣기」에 쓰는 가상 회의록(샘플 지도 「월말 정산 점검」의 업무 「대사 확인」용).
// tests/fixtures/doc-attach/demo-대사확인.txt와 같은 글이다(기한만 넣는 순간 오늘 기준으로 바꾼다). 실제 사람·조직 이름은 없다(담당은 샘플 지도의 가상 인물).

const TEXT = "대사 확인 개선 회의록\n일시: 2026. 10. 26.(월) 10:00 / 작성 부서: 가상정산팀\n1. 회의 목적\n월말 대사 확인에서 반복되는 불일치를 줄이는 방안을 정한다.\n2. 결정 사항\n① 불일치 건은 원인 코드를 붙여 기록한다.\n② 대사 결과는 보고 전에 두 사람이 확인한다.\n3. 후속 조치\n과제 담당 기한\n불일치 원인 코드표 정리 서하늘 {D1}\n대사 결과 이중 확인 절차 마련 윤바다 {D2}\n4. 미결 사항\n원천 시스템 마감 시각이 바뀌면 대사 기준일을 어떻게 맞출지 아직 정하지 못했다.\n5. 유의 사항\n대사 불일치가 3건 이상이면 보고 전에 팀장에게 먼저 알린다.\n";

/** 기한 두 곳을 오늘 기준 +7일·+14일로 바꾸는 날 수(시간이 지나도 「지난 기한」으로 해제돼 보이지 않게) */
export const DOC_ATTACH_EXAMPLE_DUE_DAYS = Object.freeze([7, 14]);

const ymdDot = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}. ${t.getUTCMonth() + 1}. ${t.getUTCDate()}.`; // 「YYYY. M. D.」
};

export const DOC_ATTACH_EXAMPLE = Object.freeze({
  title: '대사 확인 개선 회의록(샘플 「월말 정산 점검」용)',
  targetLabel: '대사 확인', // 붙일 업무가 아직 안 골라져 있고 지도에 이 이름의 업무가 하나 있으면 고른다
  /** @param {string} today 오늘(YYYY-MM-DD) */
  text: (today) => TEXT.replace('{D1}', ymdDot(today, DOC_ATTACH_EXAMPLE_DUE_DAYS[0])).replace('{D2}', ymdDot(today, DOC_ATTACH_EXAMPLE_DUE_DAYS[1])),
});
