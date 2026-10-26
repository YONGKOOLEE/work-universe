// 처음 사용 점검(2026-10-24, docs/first-use-2026-10-24.md) W2 몫: FU-4 「왜」 셋째 칸의 AI, FU-11(일부) 팀 카드 안내 한 줄, FU-9 「?」 도움말 문구.
// DOM 흉내(tests/dom-stub.js)로 순수 부분만 돌린다. 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W2」)을 대신하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from '../app/src/llm/providers.js';
import {
  HELP_CLOSE_LABEL, HELP_GEN, HELP_INTRO, HELP_SPACES, HELP_TERMS, HELP_TOUR_LABEL, helpPanel, helpTexts,
} from '../app/src/ui/help.js';
import { TEAM_NOTE, WHY_AI_BODY, startScreen } from '../app/src/ui/start.js';
import { installDom, uninstallDom } from './dom-stub.js';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
function sourcesExcept(skip) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== 'vendor') walk(p); } else if (/\.(js|html)$/.test(name) && !skip.some((s) => p.replace(/\\/g, '/').endsWith(s))) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(APP, 'src'));
  out.push(readFileSync(join(APP, 'index.html'), 'utf8'));
  return out.join('\n');
}
const quotedNames = (texts) => [...new Set(texts.flatMap((t) => [...String(t).matchAll(/「([^」]+)」/g)].map((m) => m[1])))];

const startOpts = (over = {}) => ({ universes: [], guide: {}, warnings: [], readOnly: false, onOpen() {}, onCreate() {}, onTour() {}, ...over });

test('FU-4 「왜」 AI 문장: 과장 없이 기록·근거 검사만 말함(CR-22 S: 세 칸 대신 미리 보기 설명 줄과 한 줄에 들어감)', () => {
  assert.equal(WHY_AI_BODY, 'AI가 기록만 보고 쓰고, 앱이 근거를 검사합니다');
  assert.ok(/AI/.test(WHY_AI_BODY));
  assert.ok(!/(항상|완벽|정확|자동으로 다)/.test(WHY_AI_BODY));
  assert.ok(WHY_AI_BODY.length <= 30, '칸 높이가 늘지 않게 짧게');
});

test('시작 화면: 셋째 칸에 AI 글자, 팀 카드 안에만 안내 한 줄(다른 두 카드엔 없음)', () => {
  const body = installDom();
  try {
    const root = startScreen(startOpts());
    body.append(root);
    assert.ok(root.querySelector('[data-testid=start-preview-caption]').textContent.includes('AI가 기록만 보고 쓰고'));
    const team = root.querySelector('[data-testid=start-way-team]');
    const note = root.querySelector('[data-testid=start-way-team-note]');
    assert.equal(note.textContent, TEAM_NOTE);
    assert.ok(team.textContent.includes(TEAM_NOTE));
    assert.ok(team.textContent.includes('여러 업무를 묶은 팀·부서 지도를 봅니다'));
    assert.equal(note.className, 'way-note');
    assert.equal(root.querySelector('[data-testid=start-way-handover-note]'), null);
    assert.equal(root.querySelector('[data-testid=start-way-mine-note]'), null);
    assert.equal(TEAM_NOTE, '팀원 각자 만든 지도는 공유 폴더(「폴더 연결」)나 「가져오기」로 모아 묶습니다');
    assert.ok(!root.textContent.includes('null'));
  } finally { uninstallDom(); }
});

test('시작 화면 처음 보이는 글(「…」 밖)에 유니버스·노드·꼭지가 없다(팀 안내 포함, CR-16 ②)', () => {
  assert.ok(!/유니버스|노드|꼭지/.test(TEAM_NOTE.replace(/「[^」]*」/g, '')));
  assert.ok(!/유니버스|노드|꼭지/.test(WHY_AI_BODY));
});

test('FU-9 도움말 문구: 한 줄 설명·왼쪽 공간 5개·용어 7개·생성 방식 3개 이름과 순서', () => {
  assert.equal(HELP_INTRO, '이 앱은 업무마다 누가 언제 무엇을 했는지 기록해 두고, 담당자가 바뀔 때 근거 달린 인수인계 초안과 「혼자만 아는 업무」 경고를 만듭니다.');
  // CR-22 W: 용어에 묶은 지도·혼자만 아는 일·미해결을 더했고(4 → 7), 왼쪽 공간 5줄 절을 더했다. 「항목」은 동그라미가 아니라 도형(모양이 유형마다 다르다)
  assert.deepEqual(HELP_SPACES.map((t) => t.term), ['지도 보기', '기록', '인수인계', '매주 점검', '지도 관리']);
  // 쉬운 말(사용자 10-26 저녁): 산출물·인사이트·통합 확인·편집 되감기를 더함(7 → 11)
  assert.deepEqual(HELP_TERMS.map((t) => t.term), ['업무 지도', '항목', '지도 중심', '묶은 지도', '혼자만 아는 일', '미해결', '근거 칩', '산출물', '인사이트', '통합 확인', '편집 되감기']); // CR-18-2
  assert.deepEqual(HELP_GEN.map((t) => t.term), ['사전 생성', '규칙 기반', 'Claude API']);
  assert.ok(HELP_TERMS[1].desc.includes('사람·업무·산출물·주제·조직'));
  assert.ok(HELP_TERMS[2].desc.includes('업무 지도 전체'));
  assert.ok(![...HELP_TERMS, ...HELP_GEN].some((t) => /유니버스/.test(`${t.term} ${t.desc}`)), '도움말에 「유니버스」가 없다(CR-17 A)');
  assert.ok(HELP_TERMS[6].desc.includes('「근거:」') && HELP_TERMS[6].desc.includes('빛납니다'));
  assert.ok(HELP_GEN[0].desc.includes('근거를 검사'));
  assert.ok(HELP_GEN[2].desc.includes('「설정」'));
  for (const t of [...HELP_TERMS, ...HELP_GEN]) assert.ok(t.term && t.desc, t.term);
});

test('FU-9 도움말 속 생성 방식 이름이 설정 화면의 이름(사전 생성·규칙 기반·Claude API)과 맞는다', () => {
  const labels = PROVIDERS.map((p) => p.label).join(' / ');
  for (const t of HELP_GEN) assert.ok(labels.includes(t.term), `${t.term} ← ${labels}`);
});

test('FU-9 도움말 글의 「…」 이름이 실제 화면(도움말 파일 밖 소스·index.html)에 있는 이름이다', () => {
  const src = sourcesExcept(['ui/help.js']);
  const names = quotedNames(helpTexts());
  assert.ok(names.length >= 3, names.join(',')); // 4 → 3: 「유니버스」 이름이 도움말에서 빠짐(CR-17 A)
  for (const n of names) {
    if (n === HELP_TOUR_LABEL) continue; // 도움말 단추 자신(index.html 「?」 title에도 있음, 아래에서 따로 확인)
    assert.ok(src.includes(n), `화면에 없는 이름: 「${n}」`);
  }
  assert.ok(readFileSync(join(APP, 'index.html'), 'utf8').includes(HELP_TOUR_LABEL));
  for (const n of quotedNames([TEAM_NOTE])) assert.ok(src.includes(n), `화면에 없는 이름: 「${n}」`);
});

test('FU-9 helpPanel: 제목·한 줄 설명·공간 5·용어 7·생성 방식 3(접힘), 「따라 하기 다시 보기」와 「닫기」가 각자 콜백만 부른다', () => {
  const body = installDom();
  try {
    const calls = [];
    const panel = helpPanel({ onTour: () => calls.push('tour'), onClose: () => calls.push('close') });
    body.append(panel);
    assert.equal(panel.querySelector('h2').textContent, '도움말');
    assert.equal(panel.querySelector('[data-testid=help-intro]').textContent, HELP_INTRO);
    assert.equal(panel.querySelectorAll('[data-testid=help-spaces] dt').length, 5);
    assert.equal(panel.querySelectorAll('[data-testid=help-terms] dt').length, 11); // 쉬운 말(10-26 저녁) 7 → 11
    assert.equal(panel.querySelector('[data-testid=help-gen-fold]').tagName, 'DETAILS', '문장 생성 방식은 접어 둔다');
    assert.equal(panel.querySelector('[data-testid=help-gen-fold]').attrs.has('open'), false);
    assert.equal(panel.querySelectorAll('[data-testid=help-gen] dt').length, 3);
    const tour = panel.querySelector('[data-testid=help-tour]');
    const close = panel.querySelector('[data-testid=help-close]');
    assert.equal(tour.textContent, HELP_TOUR_LABEL);
    assert.equal(close.textContent, HELP_CLOSE_LABEL);
    assert.equal(tour.textContent, '따라 하기 다시 보기');
    assert.equal(close.textContent, '닫기');
    tour.click();
    assert.deepEqual(calls, ['tour']);
    close.click();
    assert.deepEqual(calls, ['tour', 'close']);
    assert.ok(!panel.textContent.includes('null') && !panel.textContent.includes('undefined'));
  } finally { uninstallDom(); }
});
