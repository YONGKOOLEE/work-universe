// 시작 화면(R-08, 5.3): 별도 설명 없이 첫 화면에서 탐색을 시작할 수 있게 한다.
// 구성: 이게 무엇인지 한 줄 + 「무엇을 하고 싶어요?」 세 갈래 카드(2026-10-18 CR-13 A) + 작은 단추들 + 내 유니버스.
// 처음이라면 이 순서로·샘플 카드 7개는 「샘플·처음 순서 더 보기」(기본 접힘) 안에 둔다. 작은 단추들은 강조하지 않는다(세 갈래 카드가 먼저 눈에 띄게, 재검증 N-7).

import { el } from './dom.js';

// 검토5 U-2·U-3·U-6·U-8: 순서대로 따라가면 끊기지 않게, 버튼 이름은 화면과 같게, "꼭지"는 여기서 한 번 설명한다
const STEPS = [
  ['동그라미(노드)를 눌러 보세요 — 하늘색 동그라미(업무)부터', '오른쪽에 속성, 연결된 노드, 지금까지의 이력이 나옵니다(이력은 아래로 내리면 보입니다). 마우스를 올리면 연결된 것만 밝아집니다. 가장 큰 연두색 동그라미는 꼭지, 곧 이 유니버스의 중심 노드입니다.'],
  ['「인수인계 초안 만들기」를 눌러 보세요', '업무나 꼭지(유니버스의 중심 노드)를 골랐을 때, 또는 빈 곳을 눌러 선택을 풀었을 때 보입니다(사람·산출물을 고르면 보이지 않습니다). 담당자가 바뀔 때 필요한 내용을 이력에서 모아 초안으로 만들어 줍니다. 문장마다 근거를 확인할 수 있습니다.'],
  ['「인사이트 보기」를 눌러 보세요', '비슷한 일을 해 본 사람(유사 경험자), 같은 설명이 되풀이되는 패턴(반복 비효율), 일이 몰린 사람과 담당자 없는 업무(밀집·공백), 기간별 변화(흐름 변화)를 근거와 함께 보여 줍니다. 노드를 고른 뒤에도, 빈 곳을 눌러 선택을 푼 뒤에도 보입니다.'],
  ['「새 유니버스 만들기」로 업무 하나부터 만들어 보세요', '첫 업무 이름·담당자·산출물을 적으면 작은 지도가 바로 생기고, 「노드 추가」로 하나씩 늘려 내 업무를 지도처럼 만들 수 있습니다. 업무정의서가 있으면 「문서·파일 가져오기」(유니버스를 연 뒤에는 머리글의 「가져오기·내보내기」)에 붙여 넣어 초벌을 만들 수도 있습니다.'],
];

/**
 * @param {{universes:object[], guide:object, warnings:string[], readOnly:boolean, onOpen:(id)=>void, onCreate:()=>void, onCreateMine?:()=>void, onImport?:()=>void, onTour?:(id:string)=>void}} o
 *   onTour(시나리오): 그 시나리오의 예시 유니버스를 열고 따라 하기를 시작한다(세 갈래 카드 a·c)
 */
export function startScreen(o) {
  const samples = o.universes
    .filter((u) => u.is_sample)
    .sort((a, b) => ((o.guide[a.id] || {}).order || 99) - ((o.guide[b.id] || {}).order || 99));
  const mine = o.universes.filter((u) => !u.is_sample);
  const recommended = samples.find((u) => (o.guide[u.id] || {}).recommended) || samples[0];

  const card = (u) => {
    const g = o.guide[u.id] || {};
    return el('li', { class: `card${g.recommended ? ' recommended' : ''}`, 'data-testid': `card-${u.id}` },
      el('div', { class: 'card-head' }, el('strong', {}, u.name), el('span', { class: 'chip' }, u.level)),
      el('p', { class: 'muted' }, g.tagline || u.description || ''),
      el('p', { class: 'muted small' }, u.ref_count ? `하위 유니버스 ${u.ref_count}개를 묶음` : `노드 ${u.node_count}개`),
      g.try ? el('p', { class: 'try' }, `해 볼 것: ${g.try}`) : null,
      el('button', { type: 'button', class: g.recommended ? 'primary' : '', 'data-testid': `open-${u.id}`, onclick: () => o.onOpen(u.id) }, '열기'),
    );
  };

  // 세 갈래(CR-13 A): 처음 보는 사람이 "무엇을 하고 싶어?"에 답하면 앱 안 따라 하기나 새 업무 지도로 바로 들어간다. 쉬운 말: 업무 지도·동그라미
  const way = (testid, title, desc, onclick, disabled = false) => el('li', {},
    el('button', { type: 'button', class: 'start-way', 'data-testid': testid, disabled, onclick }, el('strong', {}, title), el('span', {}, desc)));
  const ways = [
    o.onTour ? way('start-way-handover', '인수인계를 앞두고 있어요', '예시 업무로 인수인계 초안을 만들어 봅니다(3분)', () => o.onTour('handover')) : null,
    way('start-way-mine', '내 업무를 정리해 두고 싶어요', '업무 하나부터 작은 지도를 만듭니다', o.onCreateMine || o.onCreate, o.readOnly),
    o.onTour ? way('start-way-team', '팀 업무를 한눈에 보고 싶어요', '여러 업무를 묶은 팀·부서 지도를 봅니다', () => o.onTour('team')) : null,
  ].filter(Boolean);

  return el('div', { class: 'start-inner' },
    el('header', { class: 'start-hero' },
      el('h1', {}, '업무 ', el('b', {}, 'UNIVERSE')),
      el('p', { class: 'lead' }, '흩어진 업무 지식을 업무별 지도로 모아, 누가 무엇을 어떻게 해 왔는지 찾아보고 인수인계 초안과 인사이트(비슷한 경험자·일 쏠림·빈 자리)를 근거와 함께 얻는 도구입니다.'),
      o.warnings.length ? el('p', { class: 'notice', 'data-testid': 'start-warning' }, o.warnings.join(' ')) : null,
      el('h2', {}, '무엇을 하고 싶어요?'),
      el('ul', { class: 'start-ways', 'data-testid': 'start-ways' }, ...ways),
      el('p', { class: 'muted small' }, '아래 단추는 따라 하기 없이 바로 시작합니다.'),
      el('div', { class: 'start-small' },
        recommended ? el('button', { type: 'button', class: '', 'data-testid': 'start-primary', onclick: () => o.onOpen(recommended.id) }, `샘플 바로 열기: ${recommended.name}`) : null,
        el('button', { type: 'button', 'data-testid': 'start-create', disabled: o.readOnly, onclick: o.onCreate }, '새 유니버스 만들기'),
        o.onImport ? el('button', { type: 'button', 'data-testid': 'start-import', disabled: o.readOnly, onclick: o.onImport }, '문서·파일 가져오기') : null,
      ),
      el('p', { class: 'muted small' }, '모든 이름과 데이터는 가상입니다. 설치나 로그인은 필요 없습니다.'),
      el('p', { class: 'muted small', 'data-testid': 'start-terms' }, '용어: 유니버스는 업무를 묶은 한 단위(업무 지도 하나), 노드는 그래프의 동그라미 하나, 꼭지는 유니버스의 중심 노드(가운데 큰 동그라미)입니다.'),
    ),
    el('section', {}, el('h2', {}, '내 유니버스'),
      mine.length
        ? el('ul', { class: 'cards', 'data-testid': 'start-mine' }, ...mine.map(card))
        : el('p', { class: 'muted', 'data-testid': 'start-mine-empty' }, '아직 없습니다. 「새 유니버스 만들기」로 시작하세요.')),
    // 접어 둔다(기본 접힘): 처음 보는 사람에게 목록 열한 개가 한꺼번에 보이지 않게(CR-13 A). 기능은 그대로 펼치면 있다
    el('details', { class: 'start-more', 'data-testid': 'start-more' }, el('summary', {}, '샘플·처음 순서 더 보기'),
      el('section', {}, el('h2', {}, '처음이라면 이 순서로'), el('ol', { class: 'steps-list', 'data-testid': 'start-steps' },
      ...STEPS.map(([t, d]) => el('li', {}, el('strong', {}, t), el('span', { class: 'muted' }, d))))),
      el('section', {}, el('h2', {}, '샘플 유니버스'), el('ul', { class: 'cards', 'data-testid': 'start-samples' }, ...samples.map(card))),
    ),
  );
}
