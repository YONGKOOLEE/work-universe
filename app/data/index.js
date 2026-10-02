// 내장 샘플 목록. 유니버스가 늘면(T-13) 여기에 추가한다. 첫 번째가 처음 열리는 유니버스다.
import { SAMPLE_A1 } from './sample-a1.js';
import { SAMPLE_CARD } from './sample-card.js';
import { SAMPLE_TEAM } from './sample-team.js';
import { SAMPLE_EVENT } from './sample-event.js';
import { SAMPLE_DEPT } from './sample-dept.js';

export const SAMPLES = [SAMPLE_A1, SAMPLE_CARD, SAMPLE_TEAM, SAMPLE_EVENT, SAMPLE_DEPT];

// 시작 화면의 샘플 카드 문구. order가 작을수록 앞. 추천은 처음 보는 사람에게 권하는 첫 샘플이다
export const SAMPLE_GUIDE = {
  'U-A1': { order: 1, recommended: true, tagline: '가장 쉬운 사례 — 처음이라면 여기서 시작하세요', try: '동그라미를 눌러 보고, 「인수인계 초안 만들기」를 눌러 보세요' },
  'U-D1': { order: 2, tagline: '부서 → 팀 → 업무로 여러 단계 묶은 사례', try: '접힌 큰 동그라미를 더블클릭해 펼쳐 보고, 「인사이트 보기」의 밀집·공백 탭에서 일이 몰린 사람을 찾아보세요' },
  'U-K1': { order: 3, tagline: '업무정의서 문서를 유니버스로 바꾼 사례', try: '「요청 검증」 같은 노드를 눌러 \'원문\' 속성을 확인해 보세요' },
  'U-T1': { order: 4, tagline: '업무 둘을 묶은 팀 사례', try: '「가상 결제운영팀」 꼭지에서 접고 펼쳐 보세요' },
  'U-B': { order: 5, tagline: '해마다 하는 일(행사)을 팀 안에 직접 둔 사례', try: '' },
};
