// 앱 안 따라 하기(CR-13 A, 2026-10-18): 이야기형 시나리오(handover 5단계·team 5단계)의 문구·완료 조건·짚을 대상을 한 곳에 둔다.
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
//   insightKind: string|null,  // 인사이트에서 고른 탭(risk|similar|repeat|density|flow)
//   editing: boolean,          // 노드 수정 양식이 열려 있음
//   saved: boolean,            // 따라 하기를 시작한 뒤 저장(수정·추가 등)이 한 번 성공했음
//   rewinding: boolean,        // 편집 되감기 모드가 켜져 있음(머리 띠가 보임)
//   readOnly: boolean,         // 이 유니버스를 고칠 수 없음(읽기 전용)
// }
// target(state) = 짚을 대상 후보 목록. 앞에서부터 화면에 보이는 첫 번째를 쓴다.
//   {sel: CSS 선택자, noScroll?}  화면의 요소(단추 등). 가려져 있으면 패널을 스크롤해 보이게 하지만 noScroll이면 하지 않는다
//   {cy: 그래프 노드 선택자}  그래프 노드(cytoscape)
//   hint: 문자열  그 대상 안쪽에 표지 글을 띄우고 테두리를 안쪽에 그린다(큰 영역을 짚을 때, 재검증 N-2)
// step.sub(state) = 지금 상태에서 따로 보여 줄 보조 문구(없으면 null)

export const TOUR_IDS = ['handover', 'team'];

// 「빈 곳을 누르세요」 표지 글(handover 5단계·team 마지막 단계(risk-first 순서에서는 1단계)에서 선택이 남아 있을 때 그래프 안쪽에 띄운다. 2회차 FU-26: handover 3단계에서는 쓰지 않는다)
export const BLANK_HINT = '여기 빈 곳을 누르세요';

// 시나리오 → 시작할 유니버스(따라 하기 카드가 열 때 쓴다)
const HANDOVER = {
  id: 'handover',
  universeId: 'U-A1',
  title: '인수인계 초안 만들기(월말 정산 예시)',
  // 2회차 FU-27: 샘플 데이터(app/data/sample-a1.js)의 시점에 맞춘다 — 구두 인수인계 9월 30일, 서하늘 수행 시작 10월 1일
  story: '윤바다가 9월 말 서하늘에게 월말 정산을 넘겼습니다. 서하늘이 받을 인수인계 초안을 기록에서 만들어 봅니다.',
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
      // 9차 검토 R9-4: 보내는·받는 사람은 미리 골라 두므로(preset) 동작은 둘 — 「인수인계 초안 만들기」 → 「초안 만들기」
      // 2회차 FU-26: 「빈 곳을 누르고」를 뺐다. 업무·꼭지를 고른 채로도 오른쪽에 같은 이름의 단추(btn-draft)가 있고, 선택이 없으면 지도 전체의 단추(btn-draft-universe)가 있다
      task: '오른쪽의 「인수인계 초안 만들기」를 누른 뒤 「초안 만들기」를 누르세요.',
      // 처음 사용 점검 FU-2: 대상도 미리 골라 둔다. 「대사 확인」을 고른 채 눌러도 대상은 지도 전체(꼭지)로 바뀌어 미리 써 둔 문장(사전 생성)이 있는 조합이 된다
      sub: () => '대상(월말 정산 점검 전체)과 보내는·받는 사람은 이미 골라져 있어요',
      preset: { target: '월말 정산 점검', from: '윤바다', to: '서하늘' },
      target: (s) => (s.draftOpen ? [{ sel: '[data-testid=draft-form] button[type=submit]' }]
        : s.selected ? [{ sel: '[data-testid=btn-draft]' }, { sel: '[data-testid=btn-draft-universe]' }, { sel: '#detail', noScroll: true }] // 사람·산출물을 고른 상태라면 두 단추가 모두 없다: 패널만 짚는다
          : [{ sel: '[data-testid=btn-draft-universe]' }]),
      done: (s) => s.draftShown,
    },
    {
      id: 'evidence',
      task: '문장 밑의 「근거:」 칩을 하나 눌러 보세요. 그래프에서 근거가 빛납니다.',
      target: () => [{ sel: '.draft .evidence' }],
      done: (s) => s.evidenceUsed,
    },
    {
      // 9차 검토 R9-1(나): 고친 기록을 되감아 보는 단계. 샘플에 수정 이력이 미리 있어도 「직접 고쳐 보기」로 안내한다.
      // 완료는 상태로 판정: 되감기 모드가 켜지면(머리 띠가 보임) 끝. 읽기 전용이면 고칠 수 없으므로 이 단계를 건너뛴다
      id: 'edit-rewind',
      // 처음 사용 점검 3회차: 본문은 한두 줄로 줄이고 세부 순서는 보조 문구(sub)로 옮겼다. 본문에는 이 단계가 연습이고 건너뛰어도 된다는 것과 하려는 일만 둔다
      task: '(연습, 건너뛰어도 됩니다) 「대사 확인」의 설명을 조금 고쳐 저장한 뒤, 「편집 되감기」로 고치기 전 지도를 봅니다.',
      sub: (s) => (s.saved
        ? '고쳐서 저장했어요. 이제 빈 곳을 누르고 「편집 되감기」를 누르세요'
        : '순서: 「대사 확인」 → 「수정」에서 설명 끝에 글자 하나 더하고 「저장」 → 빈 곳 → 「편집 되감기」에서 시점 고르기. 예시라서 언제든 되돌릴 수 있어요'),
      target: (s) => {
        if (s.rewinding) return [{ sel: '[data-testid=rewind-bar]' }, { sel: '[data-testid=rewind-band]' }];
        const blank = { sel: '#graph', hint: BLANK_HINT };
        const panelBusy = s.draftOpen || s.insightOpen; // 초안·인사이트가 열려 있으면 빈 곳을 눌러 개요로 돌아가야 한다
        if (s.saved) return s.selected || panelBusy ? [blank] : [{ sel: '[data-testid=btn-rewind]' }, blank];
        if (s.editing) return [{ sel: '[data-testid=node-form-edit] button[type=submit]' }];
        if (s.selected && !panelBusy) return [{ sel: '[data-testid=btn-edit]' }, { cy: 'node[label = "대사 확인"]' }];
        return [{ cy: 'node[label = "대사 확인"]' }];
      },
      done: (s) => s.rewinding || s.readOnly,
    },
  ],
};

// team 시나리오의 단계 순서. CR-17 K(승인 2026-10-24): 기본은 'risk-first'(위험 요약 「자세히」 먼저, 마지막은 전체 보기 — 처음 사용 점검 FU-14·FU-33).
// 이전 승인 문서(02 D-29: "team 시나리오는 5단계, 마지막은 내용이 있는 「반복 비효율」 탭에서 끝")의 순서는 'd29' 판이다.
// 되돌리려면 이 상수 하나만 'd29'로 바꾼다(단위 테스트가 두 순서를 모두 고정한다).
export const TEAM_ORDER = 'risk-first';
export const TEAM_ORDERS = {
  d29: ['expand', 'find', 'neighborhood', 'full', 'insight'],
  'risk-first': ['risk', 'expand', 'find', 'neighborhood', 'full'],
};

const TEAM_STEPS = {
  risk: {
    // 2회차 FU-33: 팀장의 질문(한 사람만 아는 일)에 바로 닿는다. 묶은 지도 위험 요약(FU-10)의 「자세히」가 인사이트를 「인수인계 위험」 탭으로 연다
    id: 'risk',
    task: '오른쪽 위 「혼자만 아는 일 …」 줄의 「자세히」를 누르세요. 한 사람만 해 봤고 인수인계 기록이 없는 일이 나옵니다.',
    target: (s) => [{ sel: '[data-testid=btn-team-risk-more]' }, ...(s.selected || s.draftOpen ? [{ sel: '#graph', hint: BLANK_HINT }] : [])],
    done: (s) => s.insightOpen && s.insightKind === 'risk',
  },
  expand: {
    id: 'expand',
    task: '이중 테두리 동그라미(접힌 팀) 하나를 두 번 눌러 펼쳐 보세요.',
    target: () => [{ cy: 'node[?collapsed]' }],
    done: (s) => s.expandedCount > 0,
  },
  find: {
    id: 'find',
    task: '위의 「항목 찾기」에 "대사"를 넣고 결과 하나를 고르세요.',
    target: () => [{ sel: '[data-testid=find-input]' }],
    done: (s) => !!s.foundGid,
  },
  neighborhood: {
    id: 'neighborhood',
    task: '오른쪽 첫 줄의 「주변만 보기」를 누르세요. 이어진 동그라미만 남습니다.',
    target: () => [{ sel: '[data-testid=btn-nbhd]' }, { sel: '[data-testid=more-tools] summary' }],
    done: (s) => s.nbhd,
  },
  full: {
    id: 'full',
    task: '그래프 위의 「전체 보기」를 눌러 전체 지도로 돌아오세요.',
    target: () => [{ sel: '#fit' }],
    done: (s) => !s.nbhd,
  },
  insight: {
    // 마지막 단계(D-29): 「인사이트 보기」 → 내용이 있는 「반복 비효율」 탭. 인사이트의 기본 탭은 「인수인계 위험」이라 열린 뒤 탭을 한 번 더 누른다
    id: 'insight',
    task: '빈 곳을 눌러 선택을 풀고 「인사이트 보기」를 누르세요. 맨 먼저 「인수인계 위험」(한 사람만 해 본 일)이 열립니다. 이어서 「반복 비효율」 탭을 누르세요.',
    target: (s) => (s.insightOpen ? [{ sel: '[data-testid=tab-repeat]' }]
      : s.selected || s.draftOpen ? [{ sel: '#graph', hint: BLANK_HINT }]
        : [{ sel: '[data-testid=btn-insight-universe]' }]),
    done: (s) => s.insightOpen && s.insightKind === 'repeat',
  },
};

/** 팀 시나리오(순서 order, 기본 TEAM_ORDER). 모르는 순서 이름이면 기본 순서 */
export function teamScenario(order = TEAM_ORDER) {
  const ids = Object.prototype.hasOwnProperty.call(TEAM_ORDERS, order) ? TEAM_ORDERS[order] : TEAM_ORDERS[TEAM_ORDER];
  return {
    id: 'team',
    universeId: 'U-D1',
    title: '팀 업무 한눈에 보기(가상 운영부 예시)',
    story: '정산·행사·교육 세 팀을 묶은 부서 지도입니다. 75개 중 18개만 보이고 나머지는 접혀 있어요.',
    steps: ids.map((id) => TEAM_STEPS[id]),
  };
}

const TEAM = teamScenario();

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
  return { universeId, selected: null, draftOpen: false, draftShown: false, evidenceUsed: false, expandedCount: 0, foundGid: null, nbhd: false, insightOpen: false, insightKind: null, editing: false, saved: false, rewinding: false, readOnly: false };
}
