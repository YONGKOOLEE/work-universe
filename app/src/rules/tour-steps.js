// 앱 안 따라 하기(CR-13 A, 2026-10-18): 이야기형 시나리오(handover 4단계·team 5단계)의 문구·완료 조건·짚을 대상을 한 곳에 둔다.
// 이 파일은 DOM·저장소를 쓰지 않는다(rules). 화면(ui/tour.js)이 앱 상태를 아래 state 모양으로 만들어 넘기고, 여기 함수가 참/거짓·대상을 돌려준다.
//
// state = {
//   universeId: string,        // 지금 연 유니버스 ID
//   selected: string|null,     // 고른 노드의 전역 ID(U-A1/N-001 꼴)
//   draftOpen: boolean,        // 인수인계 초안 화면이 열려 있음
//   draftShown: boolean,       // 「초안 만들기」로 결과가 그려졌음
//   evidenceUsed: boolean,     // 초안의 「근거:」 칩을 눌렀음
//   expandedCount: number,     // 펼친 하위 유니버스 수
//   foundGid: string|null,     // 「노드 찾기」로 고른 노드
//   nbhd: boolean,             // 주변만 보기 중
//   insightOpen: boolean,      // 인사이트 화면이 열려 있음
//   insightKind: string|null,  // 인사이트에서 고른 탭(similar|repeat|density|flow)
// }
// target(state) = 짚을 대상 후보 목록. 앞에서부터 화면에 보이는 첫 번째를 쓴다.
//   {sel: CSS 선택자, noScroll?}  화면의 요소(단추 등). 가려져 있으면 패널을 스크롤해 보이게 하지만 noScroll이면 하지 않는다
//   {cy: 그래프 노드 선택자}  그래프 노드(cytoscape)
//   hint: 문자열  그 대상 안쪽에 표지 글을 띄우고 테두리를 안쪽에 그린다(큰 영역을 짚을 때, 재검증 N-2)
// step.sub(state) = 지금 상태에서 따로 보여 줄 보조 문구(없으면 null)

export const TOUR_IDS = ['handover', 'team'];

// 「빈 곳을 누르세요」 단계(handover 3·team 5)에서 그래프 안쪽에 띄우는 표지 글
export const BLANK_HINT = '여기 빈 곳을 누르세요';

// 시나리오 → 시작할 유니버스(따라 하기 카드가 열 때 쓴다)
const HANDOVER = {
  id: 'handover',
  universeId: 'U-A1',
  title: '인수인계 초안 만들기(월말 정산 예시)',
  story: '윤바다가 다음 달 서하늘에게 월말 정산을 넘깁니다.',
  steps: [
    {
      id: 'pick-work',
      task: '하늘색 동그라미 「대사 확인」을 눌러 보세요. 오른쪽에 이 일을 무엇을 언제 누가 해 왔는지 나옵니다.',
      target: () => [{ cy: 'node[label = "대사 확인"]' }],
      done: (s) => s.selected === 'U-A1/N-001',
    },
    {
      id: 'read-history',
      task: '오른쪽을 아래로 내려 담당 이력과 「미해결」을 보세요. 다 봤으면 「다음」을 누르세요.',
      next: true,
      // 선택을 풀었으면(Esc 등) 패널이 유니버스 요약이라 이력이 없다: 보조 문구와 함께 「대사 확인」을 다시 짚는다(재검증 N-6)
      sub: (s) => (s.selected === 'U-A1/N-001' ? null : '「대사 확인」을 다시 누르면 이력이 보입니다'),
      target: (s) => (s.selected === 'U-A1/N-001'
        ? [{ sel: '[data-testid=history-heading]', noScroll: true }, { sel: '#detail', noScroll: true }] // 아래로 내리는 것은 사용자가 한다(문구대로)
        : [{ cy: 'node[label = "대사 확인"]' }]),
    },
    {
      id: 'make-draft',
      task: '빈 곳을 누르고 「인수인계 초안 만들기」를 누른 뒤, 보내는 사람 윤바다·받는 사람 서하늘로 「초안 만들기」를 누르세요.',
      preset: { from: '윤바다', to: '서하늘' },
      target: (s) => (s.draftOpen ? [{ sel: '[data-testid=draft-form] button[type=submit]' }]
        : s.selected ? [{ sel: '#graph', hint: BLANK_HINT }]
          : [{ sel: '[data-testid=btn-draft-universe]' }]),
      done: (s) => s.draftShown,
    },
    {
      id: 'evidence',
      task: '문장 밑의 「근거:」 칩을 하나 눌러 보세요. 그래프에서 근거가 빛납니다.',
      target: () => [{ sel: '.draft .evidence' }],
      done: (s) => s.evidenceUsed,
    },
  ],
};

const TEAM = {
  id: 'team',
  universeId: 'U-D1',
  title: '팀 업무 한눈에 보기(가상 운영부 예시)',
  story: '정산·행사·교육 세 팀을 묶은 부서 지도입니다. 75개 중 18개만 보이고 나머지는 접혀 있어요.',
  steps: [
    {
      id: 'expand',
      task: '이중 테두리 동그라미(접힌 팀) 하나를 두 번 눌러 펼쳐 보세요.',
      target: () => [{ cy: 'node[?collapsed]' }],
      done: (s) => s.expandedCount > 0,
    },
    {
      id: 'find',
      task: '위의 「노드 찾기」에 "대사"를 넣고 결과 하나를 고르세요.',
      target: () => [{ sel: '[data-testid=find-input]' }],
      done: (s) => !!s.foundGid,
    },
    {
      id: 'neighborhood',
      task: '오른쪽 첫 줄의 「주변만 보기」를 누르세요. 이어진 동그라미만 남습니다.',
      target: () => [{ sel: '[data-testid=btn-nbhd]' }, { sel: '[data-testid=more-tools] summary' }],
      done: (s) => s.nbhd,
    },
    {
      id: 'full',
      task: '그래프 위의 「전체 보기」를 눌러 전체 지도로 돌아오세요.',
      target: () => [{ sel: '#fit' }],
      done: (s) => !s.nbhd,
    },
    {
      id: 'insight',
      task: '빈 곳을 누르고 「인사이트 보기」를 누르세요. 같은 설명이 되풀이되는 곳(반복 비효율)과 비슷한 일을 해 본 사람(유사 경험자)을 근거와 함께 보여 줍니다.',
      target: (s) => (s.insightOpen ? [{ sel: '[data-testid=tab-repeat]' }]
        : s.selected ? [{ sel: '#graph', hint: BLANK_HINT }]
          : [{ sel: '[data-testid=btn-insight-universe]' }]),
      done: (s) => s.insightOpen,
    },
  ],
};

const SCENARIOS = { handover: HANDOVER, team: TEAM };

/** 시나리오 정의. 모르는 이름이면 null */
export function scenarioOf(id) {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, id) ? SCENARIOS[id] : null;
}

/** 「?」 단추: 지금 유니버스가 U-A1이면 handover, U-D1이면 team, 그 밖이면 null(두 시나리오 중 고르기) */
export function scenarioFor(universeId) {
  const hit = Object.values(SCENARIOS).find((sc) => sc.universeId === universeId);
  return hit ? hit.id : null;
}

/** 단계 문구에 나온 「…」 화면 이름 목록(실제 단추 글자와 맞는지 점검용) */
export function quotedNames(text) {
  return [...String(text).matchAll(/「([^」]+)」/g)].map((m) => m[1]);
}

/**
 * 지금 단계부터 완료 조건을 만족하는 단계를 건너뛴 새 위치.
 * 「다음」으로만 넘기는 단계(next)에서는 멈춘다. 마지막 단계를 넘으면 steps.length(끝 카드).
 */
export function advance(scenario, index, state) {
  let i = index;
  while (i < scenario.steps.length) {
    const step = scenario.steps[i];
    if (step.next || !step.done || !step.done(state)) break;
    i += 1;
  }
  return i;
}

/** 시작할 때 쓰는 빈 상태(점검·단위 테스트에서도 쓴다) */
export function emptyState(universeId = '') {
  return { universeId, selected: null, draftOpen: false, draftShown: false, evidenceUsed: false, expandedCount: 0, foundGid: null, nbhd: false, insightOpen: false, insightKind: null };
}
