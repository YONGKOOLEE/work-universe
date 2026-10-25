// 시작 화면(R-08, 5.3): 별도 설명 없이 첫 화면에서 탐색을 시작할 수 있게 한다.
// CR-22 S(2026-10-26) 두 얼굴: 처음 온 사람 = 화면 미리 보기 도식(왼쪽 공간 5 · 가운데 지도 · 오른쪽 카드, HTML·CSS) + 세 갈래 + 「더 보기」 하나.
//   다시 온 사람(내 업무 지도나 이어서 볼 지도가 있을 때) = 「왜」 한 줄 + 맨 위 「이어서 보기」 큰 카드 + 내 업무 지도 목록 + 아래 「다른 일 하기」(세 갈래) + 「더 보기」.
// 판정은 startFace(순수 함수). 저장 형식은 그대로다. 작은 단추·샘플 목록·처음 순서는 「더 보기」(기본 접힘) 안에 둔다(재검증 N-7: 세 갈래가 먼저 눈에 띄게).
// 용어(CR-16 ②): 처음 보이는 글에서는 「업무 지도」라고 쓴다. 단추 이름도 「새 업무 지도」처럼 같은 말을 쓴다(CR-17 A). data-testid는 그대로다.

import { el } from './dom.js';
import { MAP_KIND_LABEL, checkedLabel, modifiedLabel, resumeLabel } from '../rules/daily-use.js';

// CR-16 ①: 처음 보는 사람에게 "왜"를 한 줄로. 담당자가 바뀔 때(전) → 기록이 쌓이는 업무 지도 → 근거 달린 초안·경고(후)
// FU-4(처음 사용 점검 2026-10-24): 첫 화면에 AI가 하는 일이 보이게 한다. 키가 없어도 사전 생성 문장(개발 중 Claude가 작성)으로 보이므로 거짓이 아니다
export const WHY_AI_BODY = 'AI가 기록만 보고 쓰고, 앱이 근거를 검사합니다';
export const WHY_TITLE = '담당자가 바뀌어도 끊기지 않는 업무 지도';
// CR-22 S: 「왜」 세 칸은 화면 미리 보기 도식으로 바뀌었다. 한 줄 설명(다시 온 사람은 이 줄만 본다)
export const WHY_LINE = `${WHY_TITLE} — 담당·메모·산출물을 그때그때 쌓고, ${WHY_AI_BODY}.`;
export const PREVIEW_CAPTION = '왼쪽에서 하고 싶은 일을 고르면 가운데 업무 지도와 오른쪽 카드가 그 일에 맞게 바뀝니다. 담당자가 바뀔 때 머릿속에만 있던 업무가 기록으로 남습니다.';

// 미리 보기 도식(순수 데이터): 왼쪽 공간 5개 이름은 앱 왼쪽 메뉴와 같다. 가운데 점·선 좌표는 220×130 상자 안 px
export const PREVIEW_SPACES = ['지도 보기', '기록', '인수인계', '매주 점검', '지도 관리'];
export const PREVIEW_ACTIVE = '인수인계';
export const PREVIEW_BOX = { w: 220, h: 130 };
export const PREVIEW_NODES = [
  { id: 'c', x: 110, y: 62, kind: 'center' }, { id: 'w1', x: 48, y: 30, kind: 'work' }, { id: 'w2', x: 176, y: 34, kind: 'work' },
  { id: 'w3', x: 44, y: 100, kind: 'work' }, { id: 'p1', x: 178, y: 100, kind: 'person' }, { id: 'd1', x: 112, y: 112, kind: 'doc' },
];
export const PREVIEW_EDGES = [['c', 'w1'], ['c', 'w2'], ['c', 'w3'], ['w2', 'p1'], ['c', 'd1'], ['w3', 'd1']];
export const PREVIEW_CARDS = [{ title: 56, lines: [90, 70] }, { title: 44, lines: [80, 60] }, { title: 62, lines: [75] }]; // 오른쪽 카드 줄(막대 너비 %)

/** 선 하나를 CSS로 그리기 위한 값: 시작점(left,top), 길이, 각도(deg). 순수 함수 */
export function previewLines(nodes = PREVIEW_NODES, edges = PREVIEW_EDGES) {
  const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
  return edges.filter(([a, b]) => at[a] && at[b]).map(([a, b]) => {
    const dx = at[b].x - at[a].x; const dy = at[b].y - at[a].y;
    return { from: a, to: b, left: at[a].x, top: at[a].y, length: Math.round(Math.hypot(dx, dy) * 10) / 10, angle: Math.round((Math.atan2(dy, dx) * 180 / Math.PI) * 10) / 10 };
  });
}

/**
 * 시작 화면의 얼굴. 내 업무 지도(maps)가 있거나 이어서 볼 지도(resume)가 있으면 'returning', 둘 다 없으면 'first'.
 * maps 없이 불린 예전 모양(universes만)은 사람이 만든(샘플 아닌) 지도가 있으면 returning으로 본다
 */
export function startFace({ maps = null, resume = null, universes = [] } = {}) {
  const mine = maps || universes.filter((u) => !u.is_sample);
  return (mine && mine.length) || resume ? 'returning' : 'first';
}

// 세 갈래 ↔ 앱 왼쪽 공간 이름(CR-22 3.5): 인수인계 → 「인수인계」, 내 업무 → 「기록」·「지도 관리」, 팀 → 「매주 점검」
export const WAY_SPACES = { handover: '「인수인계」 공간', mine: '「기록」·「지도 관리」 공간', team: '「매주 점검」 공간' };
export const WAY_SPACE_PREFIX = '쓰는 곳: ';

// FU-11 일부: 팀 카드 설명 아래 작은 글씨 한 줄(여러 사람의 지도를 모으는 길)
export const TEAM_NOTE = '팀원 각자 만든 지도는 공유 폴더(「폴더 연결」)나 「가져오기」로 모아 묶습니다';

// 검토5 U-2·U-3·U-6·U-8: 순서대로 따라가면 끊기지 않게, 버튼 이름은 화면과 같게, "꼭지"는 여기서 한 번 설명한다
const STEPS = [
  ['동그라미(항목)를 눌러 보세요 — 하늘색 동그라미(업무)부터', '오른쪽에 속성, 연결된 항목, 지금까지의 이력이 나옵니다(이력은 아래로 내리면 보입니다). 마우스를 올리면 연결된 것만 밝아집니다. 가장 큰 연두색 동그라미는 지도 중심, 곧 이 업무 지도의 한가운데입니다.'],
  ['「인수인계 초안 만들기」를 눌러 보세요', '업무나 지도 중심(연두색 큰 동그라미)을 골랐을 때, 또는 빈 곳을 눌러 선택을 풀었을 때 보입니다(사람·산출물을 고르면 보이지 않습니다). 담당자가 바뀔 때 필요한 내용을 이력에서 모아 초안으로 만들어 줍니다. 문장마다 근거를 확인할 수 있습니다.'],
  ['「인사이트 보기」를 눌러 보세요', '비슷한 일을 해 본 사람(유사 경험자), 같은 설명이 되풀이되는 패턴(반복 비효율), 일이 몰린 사람과 담당자 없는 업무(밀집·공백), 기간별 변화(흐름 변화)를 근거와 함께 보여 줍니다. 항목을 고른 뒤에도, 빈 곳을 눌러 선택을 푼 뒤에도 보입니다.'],
  ['「새 업무 지도 만들기」로 업무 하나부터 만들어 보세요', '첫 업무 이름·담당자·산출물을 적으면 작은 지도가 바로 생기고, 「사람·업무·문서 추가」로 하나씩 늘려 내 업무를 지도처럼 만들 수 있습니다. 업무정의서가 있으면 「문서·파일 가져오기」(업무 지도를 연 뒤에는 머리글의 「가져오기·내보내기」)에 붙여 넣어 초벌을 만들 수도 있습니다.'],
];

/**
 * @param {{universes:object[], guide:object, warnings:string[], readOnly:boolean, onOpen:(id)=>void, onCreate:()=>void, onCreateMine?:()=>void, onImport?:()=>void, onTour?:(id:string)=>void,
 *   maps?:object[], resume?:{id:string,name:string}|null}} o
 *   maps(CR-18 D-1): 「내 업무 지도」에 보일 목록(rules/daily-use.js startMaps — 내가 만든 지도·고친 샘플·최근 연 지도, 마지막 수정일 포함). 없으면 예전처럼 내가 만든 지도만
 *   resume(D-1): 「이어서 보기」 대상. 없으면 큰 카드 없음
 *   onTour(시나리오): 그 시나리오의 예시 업무 지도를 열고 따라 하기를 시작한다(세 갈래 카드 a·c)
 */
export function startScreen(o) {
  const samples = o.universes
    .filter((u) => u.is_sample)
    .sort((a, b) => ((o.guide[a.id] || {}).order || 99) - ((o.guide[b.id] || {}).order || 99));
  const mine = o.maps || o.universes.filter((u) => !u.is_sample);
  const recommended = samples.find((u) => (o.guide[u.id] || {}).recommended) || samples[0];
  const face = startFace({ maps: o.maps, resume: o.resume, universes: o.universes });

  const card = (u) => {
    const g = o.guide[u.id] || {};
    return el('li', { class: `card${g.recommended ? ' recommended' : ''}`, 'data-testid': `card-${u.id}` },
      el('div', { class: 'card-head' }, el('strong', {}, u.name), el('span', { class: 'chip' }, u.level)),
      el('p', { class: 'muted' }, g.tagline || u.description || ''),
      el('p', { class: 'muted small' }, u.ref_count ? `하위 업무 지도 ${u.ref_count}개를 묶음` : `항목 ${u.node_count}개`),
      g.try ? el('p', { class: 'try' }, `해 볼 것: ${g.try}`) : null,
      el('button', { type: 'button', class: g.recommended ? 'primary' : '', 'data-testid': `open-${u.id}`, onclick: () => o.onOpen(u.id) }, '열기'),
    );
  };

  // 내 업무 지도 목록 카드(D-1): 마지막 수정일을 함께 보인다. 샘플은 샘플 목록의 카드와 testid가 겹치지 않게 mine-* 를 쓴다
  const mapBody = (u) => [
    el('div', { class: 'card-head' }, el('strong', {}, u.name), el('span', { class: 'chip' }, u.level), MAP_KIND_LABEL[u.kind] ? el('span', { class: 'chip', 'data-testid': 'map-kind' }, MAP_KIND_LABEL[u.kind]) : null),
    el('p', { class: 'muted small', 'data-testid': 'map-modified' }, modifiedLabel(u.modified)),
    u.checked ? el('p', { class: 'muted small', 'data-testid': 'map-checked' }, checkedLabel(u.checked)) : null,
    el('p', { class: 'muted small' }, u.ref_count ? `하위 업무 지도 ${u.ref_count}개를 묶음` : `항목 ${u.node_count}개`),
  ];
  const mapCard = (u) => {
    if (!u.kind) return card(u); // maps 없이 불린 예전 모양
    const sample = u.is_sample;
    return el('li', { class: 'card', 'data-testid': `${sample ? 'mine-card' : 'card'}-${u.id}`, 'data-kind': u.kind },
      ...mapBody(u),
      el('button', { type: 'button', 'data-testid': `${sample ? 'mine-open' : 'open'}-${u.id}`, onclick: () => o.onOpen(u.id) }, '열기'),
    );
  };

  // 이어서 보기 큰 카드(CR-22 S): 이어서 볼 지도의 정보를 목록 카드와 같은 testid로 보이고, 누르는 단추는 하나(start-resume)다.
  // 같은 지도를 여는 길이 큰 카드와 목록으로 나뉘지 않게 이 지도는 아래 목록에서 뺀다
  const resumeCard = () => {
    const row = (o.maps || []).find((u) => u.id === o.resume.id);
    const base = o.universes.find((u) => u.id === o.resume.id) || {};
    const u = row || { ...base, modified: null, checked: null, kind: null };
    return el('section', { class: 'start-resume-card', 'data-testid': 'start-resume-card' },
      el('h2', {}, '이어서 보기'),
      el('div', { class: 'card resume-card', 'data-testid': `${u.is_sample ? 'mine-card' : 'card'}-${o.resume.id}`, 'data-kind': u.kind || '' },
        ...(u.kind ? mapBody(u) : [el('div', { class: 'card-head' }, el('strong', {}, o.resume.name))]),
        el('button', { type: 'button', class: 'primary', 'data-testid': 'start-resume', onclick: () => o.onOpen(o.resume.id) }, resumeLabel(o.resume.name))));
  };
  const listMaps = o.resume ? mine.filter((u) => u.id !== o.resume.id) : mine;

  // 세 갈래(CR-13 A): 처음 보는 사람이 "무엇을 하고 싶어?"에 답하면 앱 안 따라 하기나 새 업무 지도로 바로 들어간다. 공간 이름과 맞춘 한 줄(CR-22 S)
  const way = (testid, title, desc, space, onclick, disabled = false, note = '') => el('li', {},
    el('button', { type: 'button', class: 'start-way', 'data-testid': testid, disabled, onclick }, el('strong', {}, title), el('span', {}, desc),
      el('span', { class: 'way-space', 'data-testid': `${testid}-space` }, WAY_SPACE_PREFIX + space),
      note ? el('span', { class: 'way-note', 'data-testid': `${testid}-note` }, note) : null));
  const ways = [
    o.onTour ? way('start-way-handover', '인수인계를 앞두고 있어요', '넘기는 쪽도 받는 쪽도 — 예시 업무로 인수인계 초안을 봅니다(3분)', WAY_SPACES.handover, () => o.onTour('handover')) : null,
    way('start-way-mine', '내 업무를 정리해 두고 싶어요', '업무 하나부터 작은 지도를 만듭니다', WAY_SPACES.mine, o.onCreateMine || o.onCreate, o.readOnly),
    o.onTour ? way('start-way-team', '팀 업무를 한눈에 보고 싶어요', '여러 업무를 묶은 팀·부서 지도를 봅니다', WAY_SPACES.team, () => o.onTour('team'), false, TEAM_NOTE) : null,
  ].filter(Boolean);
  const waysList = () => el('ul', { class: 'start-ways', 'data-testid': 'start-ways' }, ...ways);

  // 화면 미리 보기 도식(HTML·CSS만, 이미지 없음). 눌러지지 않고 스크린리더에는 한 문장으로 읽힌다
  const dot = (n) => el('i', { class: `pv-node pv-${n.kind}`, style: `left:${n.x}px;top:${n.y}px` });
  const preview = () => el('div', { class: 'start-preview', 'data-testid': 'start-preview', role: 'img', 'aria-label': `화면 미리 보기: 왼쪽 ${PREVIEW_SPACES.length}개 공간(${PREVIEW_SPACES.join('·')}), 가운데 업무 지도, 오른쪽 카드` },
    el('div', { class: 'pv-side', 'data-testid': 'start-preview-spaces' }, ...PREVIEW_SPACES.map((s) => el('span', { class: `pv-space${s === PREVIEW_ACTIVE ? ' on' : ''}` }, s))),
    el('div', { class: 'pv-map', style: `width:${PREVIEW_BOX.w}px;height:${PREVIEW_BOX.h}px`, 'data-testid': 'start-preview-map' },
      ...previewLines().map((l) => el('i', { class: 'pv-line', style: `left:${l.left}px;top:${l.top}px;width:${l.length}px;transform:rotate(${l.angle}deg)` })),
      ...PREVIEW_NODES.map(dot)),
    el('div', { class: 'pv-cards', 'data-testid': 'start-preview-cards' }, ...PREVIEW_CARDS.map((c) => el('div', { class: 'pv-card' },
      el('b', { style: `width:${c.title}%` }), ...c.lines.map((w) => el('u', { style: `width:${w}%` }))))));

  // 「더 보기」 하나: 작은 단추(바로 시작)·용어·처음 순서·샘플 목록. 기본 접힘이라 첫 화면의 선택은 세 갈래뿐이다
  const more = () => el('details', { class: 'start-more', 'data-testid': 'start-more' }, el('summary', {}, '더 보기'),
    el('section', {},
      el('p', { class: 'muted small' }, '아래 단추는 따라 하기 없이 바로 시작합니다.'),
      el('div', { class: 'start-small' },
        recommended ? el('button', { type: 'button', class: '', 'data-testid': 'start-primary', onclick: () => o.onOpen(recommended.id) }, `샘플 바로 열기: ${recommended.name}`) : null,
        el('button', { type: 'button', 'data-testid': 'start-create', disabled: o.readOnly, onclick: o.onCreate }, '새 업무 지도 만들기'),
        o.onImport ? el('button', { type: 'button', 'data-testid': 'start-import', disabled: o.readOnly, onclick: o.onImport }, '문서·파일 가져오기') : null,
      ),
      el('p', { class: 'muted small', 'data-testid': 'start-terms' }, '용어: 업무 지도는 업무를 묶은 한 단위, 항목은 그래프의 동그라미 하나, 지도 중심은 업무 지도의 중심(연두색 큰 동그라미)입니다.')),
    el('section', {}, el('h2', {}, '처음이라면 이 순서로'), el('ol', { class: 'steps-list', 'data-testid': 'start-steps' },
      ...STEPS.map(([t, d]) => el('li', {}, el('strong', {}, t), el('span', { class: 'muted' }, d))))),
    el('section', {}, el('h2', {}, '샘플 업무 지도'), el('ul', { class: 'cards', 'data-testid': 'start-samples' }, ...samples.map(card))),
  );

  const warn = o.warnings.length ? el('p', { class: 'notice', 'data-testid': 'start-warning' }, o.warnings.join(' ')) : null;
  const fake = el('p', { class: 'muted small' }, '모든 이름과 데이터는 가상입니다. 설치나 로그인은 필요 없습니다.');
  const title = el('h1', {}, '업무 ', el('b', {}, 'UNIVERSE'));

  if (face === 'first') {
    return el('div', { class: 'start-inner', 'data-face': 'first' },
      el('header', { class: 'start-hero' }, title,
        el('section', { class: 'why-block', 'data-testid': 'why-block', 'aria-label': WHY_TITLE },
          el('p', { class: 'why-title' }, WHY_TITLE),
          el('div', { class: 'why-preview' }, preview(), el('p', { class: 'why-caption', 'data-testid': 'start-preview-caption' }, `${PREVIEW_CAPTION} ${WHY_AI_BODY}.`))),
        warn,
        el('h2', {}, '무엇을 하고 싶어요?'), waysList(), fake),
      more());
  }
  return el('div', { class: 'start-inner', 'data-face': 'returning' },
    el('header', { class: 'start-hero' }, title,
      el('p', { class: 'why-block why-line', 'data-testid': 'why-block' }, WHY_LINE), warn),
    o.resume ? resumeCard() : null,
    listMaps.length ? el('section', {}, el('h2', {}, '내 업무 지도'), el('ul', { class: 'cards', 'data-testid': 'start-mine' }, ...listMaps.map(mapCard))) : null,
    el('section', { class: 'start-other', 'data-testid': 'start-other' }, el('h2', {}, '다른 일 하기'), waysList(), fake),
    more());
}
