// 실행 안내(docs/submission/실행안내.html) "5분 둘러보기"(CR-22: 작업 공간 기준 8단계)를 그대로 따라가는 점검(T-15 보조, R-08 대리 관찰을 대신하지는 않음).
// 테스트 ID 대신 화면에 보이는 글자로 버튼을 찾고, 실제 마우스·키보드 입력으로 누른다. 안내 문구와 화면이 어긋나면 실패한다.
// 사용: npm run build && node tools/guide-check.mjs      (PAGE=다른 index.html 경로, SHOT_DIR=스크린샷 폴더)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { killOwnBrowsers, pickBrowsers } from './browsers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pageUrl = `${pathToFileURL(process.env.PAGE || join(root, 'dist/index.html')).href}?check`; // ?check: 점검용 전역을 켠다
const BROWSERS = [
  { name: 'Chrome', exe: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  { name: 'Edge', exe: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' },
].filter((b) => existsSync(b.exe));
const PICKED = pickBrowsers(BROWSERS); // --only=chrome 이면 Chrome만
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

// 실행 안내의 단계에서 「…」로 묶은 화면 이름을 뽑는다(안내 문구가 바뀌면 점검도 따라간다)
const guide = await readFile(join(root, 'docs/submission/실행안내.html'), 'utf8');
const stepsHtml = guide.slice(guide.indexOf('5분 둘러보기'), guide.indexOf('</ol>', guide.indexOf('5분 둘러보기')));
const labels = [...stepsHtml.matchAll(/「([^」]+)」/g)].map((m) => m[1]);

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  const opened = new Promise((r) => { ws.onopen = r; });
  return { opened, send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }, close: () => ws.close() };
}
async function ev(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(cdp, expr, t = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { try { if (await ev(cdp, expr)) return true; } catch { /* 로딩 중 */ } await sleep(100); }
  return false;
}
async function mouseAt(cdp, x, y) {
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    await sleep(30);
  }
  await sleep(250);
}
// 화면에 보이는 글자로 버튼을 찾아 그 위치를 실제 마우스로 누른다
async function clickText(cdp, text, selector = 'button') {
  const pos = await ev(cdp, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((b) => b.offsetParent && b.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(text)})); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!pos) return false;
  await mouseAt(cdp, pos.x, pos.y);
  return true;
}
// 그래프 노드를 이름으로 찾아 실제 마우스로 누른다
async function clickNode(cdp, label) {
  const pos = await ev(cdp, `(() => { const n = window.__wu.cy.nodes().filter((x) => x.data('label') === ${JSON.stringify(label)}); if (n.empty()) return null; const p = n[0].renderedPosition(); const r = document.getElementById('graph').getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; })()`);
  if (!pos) return false;
  await mouseAt(cdp, pos.x, pos.y);
  return true;
}
// 셀렉트에서 화면 글자로 고른다
const pickOption = (cdp, selector, text) => ev(cdp, `(() => { const s = document.querySelector(${JSON.stringify(selector)}); const o = [...s.options].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!o) return false; s.value = o.value; s.dispatchEvent(new Event('change')); return true; })()`);
const panel = (cdp) => ev(cdp, "document.getElementById('detail').textContent");

async function shot(cdp, name) {
  if (!process.env.SHOT_DIR) return;
  await mkdir(process.env.SHOT_DIR, { recursive: true });
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(process.env.SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
}

async function walk(browser, port) {
  console.log(`\n== ${browser.name}: 실행 안내 따라가기`);
  const profile = join(root, '.tmp', `guide-check-${browser.name}`);
  killOwnBrowsers(profile); // 앞선 점검이 멈춰 남긴 것만(사용자 브라우저는 그대로)
  await rm(profile, { recursive: true, force: true });
  const proc = spawn(browser.exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--proxy-server=http://127.0.0.1:9', '--window-size=1280,860', 'about:blank'], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 100 && !wsUrl; i += 1) { try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* 시작 전 */ } await sleep(100); }
  const cdp = connect(wsUrl);
  await cdp.opened;
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  // 내려받기는 점검용 프로필 안으로(사용자의 다운로드 폴더에 파일을 남기지 않음)
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: join(profile, 'downloads') });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  try {
    // 더블클릭으로 연 것처럼 주소에 #이 없이 연다
    await cdp.send('Page.navigate', { url: pageUrl });
    check('처음 화면(시작 화면)이 열림', await waitFor(cdp, 'window.__wu && window.__wu.start === true'));
    const L = (pred) => labels.find(pred); // 안내 단계에서 뽑은 「…」 이름 중 조건에 맞는 첫 것
    const need = (name, text) => { check(`안내 둘러보기에 「${text}」가 적혀 있음(${name})`, labels.includes(text)); return text; };
    const wsBtn = (name) => clickText(cdp, name, '.ws-btn'); // 왼쪽 작업 공간 메뉴(CR-22 W)
    const closeScreen = () => clickText(cdp, '닫기', '#detail button');
    // 1단계: 처음 화면 → 「더 보기」 → 「샘플 바로 열기」
    const startText = await ev(cdp, 'document.body.innerText');
    check('1단계: 처음 화면에 화면 미리 보기와 「무엇을 하고 싶어요?」 세 갈래가 있음', (await ev(cdp, "!!document.querySelector('[data-testid=start-preview]')")) && startText.includes('무엇을 하고 싶어요?') && (await ev(cdp, "document.querySelectorAll('[data-testid=start-ways] button').length")) === 3);
    const moreLabel = need('1단계', '더 보기');
    const sampleLabel = L((l) => l.startsWith('샘플 바로 열기'));
    check(`1단계: 「${moreLabel}」를 열고 「${sampleLabel}」를 누르면 월말 정산이 열림`, !!sampleLabel && await clickText(cdp, moreLabel, 'summary') && await clickText(cdp, sampleLabel) && await waitFor(cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-A1' && window.__wu.cy.nodes().length > 0"));
    await sleep(1200);
    const menu = await ev(cdp, "[...document.querySelectorAll('.ws-btn .ws-label')].map((b) => b.textContent).join('|')");
    check('1단계: 지도를 열면 왼쪽에 작업 공간 메뉴 5개(안내에 적힌 이름)', ['지도 보기', '기록', '인수인계', '매주 점검', '지도 관리'].every((n) => menu.includes(n) && labels.includes(n)), menu);
    check('1단계: 머리글에 「무엇을 할까요?」 칸과 「?」가 있음', (await ev(cdp, "!![...document.querySelectorAll('header input')].find((i) => (i.getAttribute('aria-label') || '').includes('무엇을 할까요?'))")) && labels.includes('무엇을 할까요?') && labels.includes('?'));
    await shot(cdp, `${browser.name}-g1-open`);
    // 2단계: 항목 카드
    const clicked = await clickNode(cdp, '대사 확인');
    const p2 = await panel(cdp);
    check('2단계: 「대사 확인」을 누르면 항목 카드(위 띠·상태 줄·동작 줄·지금 볼 것·접는 묶음)가 나오고 이름이 안내와 같음', clicked && ['← 지도 전체', '기록 남기기', '담당 넘기기', '인수인계 초안', '⋯', '지금 볼 것', '기록(이력)', '모두 보기 →', '미해결 2건', '⚠ 반복 비효율'].every((t) => labels.includes(t)) && ['← 지도 전체', '기록 남기기', '담당 넘기기', '인수인계 초안', '⋯', '지금 볼 것', '기록(이력)', '미해결 2건', '반복 비효율'].every((t) => p2.includes(t)), p2.slice(0, 60));
    await shot(cdp, `${browser.name}-g2-node`);
    const ok2a = await clickText(cdp, '기록 남기기', '#detail button');
    await sleep(300);
    const gateText = await panel(cdp);
    const recDisabled = await ev(cdp, "(() => { const b = [...document.querySelectorAll('#detail button')].find((x) => x.offsetParent && x.textContent.trim() === '기록하기'); return b ? b.disabled : null; })()");
    check('2단계: 「기록 남기기」 양식은 분류 칩 4개를 고르기 전에는 「분류를 고르세요」가 보이고 「기록」이 막힘', ok2a && ['진행 중', '이슈', '주의사항', '해결됨'].every((t) => gateText.includes(t)) && gateText.includes('분류를 고르세요') && recDisabled === true, `기록 단추 막힘=${recDisabled}`);
    const cancelOk = await clickText(cdp, '취소', '#detail button');
    const backOk = await clickText(cdp, '← 지도 전체', '#detail button');
    await sleep(300);
    check('2단계: 「취소」 뒤 「← 지도 전체」를 누르면 카드가 닫히고 지도 전체 화면으로 돌아옴', cancelOk && backOk && !(await panel(cdp)).includes('지금 볼 것'));
    // 3단계: 왼쪽 「인수인계」 → 「인수인계 초안 만들기」 → 윤바다 → 서하늘 → 「초안 만들기」
    const ok3m = await wsBtn(need('3단계', '인수인계'));
    const spaceText = await panel(cdp);
    check('3단계: 「인수인계」 공간에 「담당 공백 업무」·「혼자만 아는 일」·「최근 확정한 인수인계서」 목록', ok3m && ['담당 공백 업무', '혼자만 아는 일', '최근 확정한 인수인계서'].every((t) => spaceText.includes(t)));
    const ok3a = ok3m && await clickText(cdp, L((l) => l === '인수인계 초안 만들기') || '인수인계 초안 만들기');
    const ok3b = (await pickOption(cdp, '[data-testid=draft-from]', '윤바다')) && (await pickOption(cdp, '[data-testid=draft-to]', '서하늘'));
    const ok3c = await clickText(cdp, '초안 만들기', '#detail button');
    await sleep(300);
    const p3 = await panel(cdp);
    const chips = await ev(cdp, "document.querySelectorAll('.draft .evidence').length");
    check('3단계: 「인수인계 초안 만들기」 → 윤바다·서하늘 → 「초안 만들기」: 근거 버튼과 유사 경험자에 직접 해 본 이전 담당자 한가람(CR-17 B), 맨 아래 「다음에 해 볼 것」', ok3a && ok3b && ok3c && chips > 5 && p3.includes('한가람') && p3.includes('직접') && p3.includes('다음에 해 볼 것'), `근거 ${chips}개`);
    check('3단계: 생성 방식이 보임(기본 사전 생성)', p3.includes('생성 방식: 사전 생성'));
    await shot(cdp, `${browser.name}-g3-draft`);
    // 4단계: 왼쪽 「매주 점검」 → 「인사이트 보기」
    const ok4m = await wsBtn(need('4단계', '매주 점검')); // 공간을 옮기면 열린 초안은 닫힌다
    const checkText = await panel(cdp);
    check('4단계: 「매주 점검」 공간에 「혼자만 아는 일」·「일 몰린 사람」·「담당 공백 업무」 목록', ok4m && ['혼자만 아는 일', '일 몰린 사람', '담당 공백 업무'].every((t) => checkText.includes(t)));
    const ok4 = ok4m && await clickText(cdp, L((l) => l.includes('인사이트')));
    const tabs = await ev(cdp, "[...document.querySelectorAll('.tabs .tab')].map((t) => t.textContent).join('|')");
    check('4단계: 「인사이트 보기」에 유사 경험자·반복 비효율·밀집·공백·흐름 변화 탭과 "사람이 정합니다"', ok4 && ['유사 경험자', '반복 비효율', '밀집·공백', '흐름 변화'].every((t) => tabs.includes(t)) && (await panel(cdp)).includes('사람이 정합니다'), tabs);
    check('4단계: 첫 탭이 「인수인계 위험」', tabs.startsWith('인수인계 위험'), tabs);
    await shot(cdp, `${browser.name}-g4-insight`);
    await closeScreen();
    // 5단계: 왼쪽 「지도 보기」 → 시간 보기 막대를 왼쪽으로(실제 끌기)
    await wsBtn('지도 보기');
    await sleep(300);
    const zoomOk = await ev(cdp, "['＋', '－', '맞춤'].every((t) => [...document.querySelectorAll('button')].some((b) => b.offsetParent && b.textContent.trim() === t))");
    check('5단계: 그래프에 「＋」·「－」·「맞춤」 단추가 보이고 안내에 적혀 있음', zoomOk && ['＋', '－', '맞춤'].every((t) => labels.includes(t)));
    const bar = await ev(cdp, "(() => { const r = document.querySelector('#timebar input[type=range]').getBoundingClientRect(); return { x1: r.right - 4, x2: r.left + r.width * 0.2, y: r.top + r.height / 2 }; })()");
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x1, y: bar.y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bar.x1, y: bar.y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: bar.x1 + ((bar.x2 - bar.x1) * i) / 8, y: bar.y, button: 'left', buttons: 1 });
      await sleep(40);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bar.x2, y: bar.y, button: 'left', clickCount: 1 });
    await sleep(300);
    const when = await ev(cdp, "document.getElementById('timebar').textContent");
    const faded = await ev(cdp, "window.__wu.cy.elements('.time-off').length");
    check(`5단계: 「${L((l) => l.includes('시간'))}」 막대를 마우스로 끌면 과거 기준일과 흐린 담당`, /\d{4}-\d{2}-\d{2} 기준/.test(when) && faded > 0, when.slice(0, 60));
    await shot(cdp, `${browser.name}-g5-time`);
    // 6단계: 안내에서 고른 지도 이름(「가상 운영부 …」)들. 내용으로 고르고 중복을 뺀다
    for (const name of [...new Set(labels.filter((l) => l.startsWith('가상 운영부')))]) {
      const short = name.replace(/\(.*\)/, '').trim();
      const ok = await pickOption(cdp, '#universe-picker', short);
      await sleep(800);
      check(`6단계: 위쪽 목록에서 「${name}」을 고를 수 있고 열림`, ok && await waitFor(cdp, `window.__wu && window.__wu.doc && window.__wu.doc.universe.name === ${JSON.stringify(short)}`));
    }
    await shot(cdp, `${browser.name}-g6-org`);
    // 6단계(이어서): 부서 → 「매주 점검」 → 위험 요약 한 줄·「자세히」·「이번 점검 저장」·「점검 요약 보기」
    await pickOption(cdp, '#universe-picker', '가상 운영부 (부서)');
    await sleep(800);
    await waitFor(cdp, "window.__wu && window.__wu.doc && window.__wu.doc.universe.id === 'U-D1' && window.__wu.cy.nodes().length > 0");
    const okw = await wsBtn('매주 점검');
    const wk = await panel(cdp);
    const moreName = need('6단계', '자세히');
    check('6단계: 부서의 「매주 점검」에 「혼자만 아는 일 n · 일 몰린 사람 n · 담당자 빈 일 n」 한 줄과 「자세히」·「이번 점검 저장」·「점검 요약 보기」', okw && /혼자만 아는 일 \d+개? · 일 몰린 사람 \d+명? · 담당자 빈 일 \d+/.test(wk) && wk.includes(moreName) && wk.includes(need('6단계', '이번 점검 저장')) && wk.includes(need('6단계', '점검 요약 보기')), wk.slice(0, 100));
    const okMore = await clickText(cdp, moreName, '#detail button');
    await sleep(400);
    const riskOpen = await ev(cdp, "!![...document.querySelectorAll('.tabs .tab')].find((t) => t.textContent.includes('인수인계 위험'))");
    check('6단계: 「자세히」를 누르면 「인수인계 위험」 탭이 열림', okMore && riskOpen);
    await closeScreen();
    const okSave = await clickText(cdp, '이번 점검 저장', '#detail button');
    await sleep(300);
    const saved = await panel(cdp);
    check('6단계: 「이번 점검 저장」 뒤 "다음 점검 날부터"가 보임(같은 날은 비교하지 않음)', okSave && saved.includes('다음 점검 날부터'));
    const okSum = await clickText(cdp, '점검 요약 보기', '#detail button');
    await sleep(400);
    const sum = await panel(cdp);
    check('6단계: 「점검 요약 보기」에 「복사」·「내려받기(.txt)」·「인쇄」', okSum && ['점검 요약', '복사', '내려받기(.txt)', '인쇄'].every((t) => sum.includes(t)));
    await closeScreen();
    await shot(cdp, `${browser.name}-g6-weekly`);
    // 7단계: 「지도 보기」 → 「항목 찾기」에 "대사" 입력(실제 입력) → 결과를 마우스로 고름 → 「⋯」 → 「주변만 보기」 → 「전체 보기」
    await wsBtn('지도 보기');
    const findLabel = labels.find((l) => l.includes('찾기'));
    const nbLabel = labels.find((l) => l.includes('주변만 보기'));
    const allLabel = labels.find((l) => l === '전체 보기');
    await sleep(300);
    const findPos = await ev(cdp, `(() => { const i = [...document.querySelectorAll('input')].find((x) => (x.getAttribute('aria-label') || '').includes(${JSON.stringify(findLabel || '')}) && x.offsetParent); if (!i) return null; const r = i.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; })()`);
    if (findPos) {
      await mouseAt(cdp, findPos.x, findPos.y);
      await cdp.send('Input.insertText', { text: '대사' });
      await sleep(300);
    }
    const pickedOk = !!findPos && await clickText(cdp, '대사 확인', '[data-testid=find-hit]');
    await sleep(500);
    const p7 = await panel(cdp);
    check(`7단계: 「${findLabel}」 칸에 "대사"를 넣고 결과 「대사 확인」을 누르면 카드가 열림`, pickedOk && p7.includes('대사 확인') && p7.includes('⋯') && p7.includes('기록(이력)'), p7.slice(0, 40)); // 묶은 지도에서 다른 업무 지도의 항목은 읽기만 되어 「기록 남기기」가 없다
    const before7 = await ev(cdp, 'window.__wu.cy.nodes().length');
    // 「주변만 보기」는 카드의 「⋯」 메뉴 안에 있다(안내: 「⋯」를 열고). 닫힌 메뉴 속 단추는 눈에 안 보이므로 「⋯」를 눌러 연 뒤, 실제로 그 자리가 눌리는지(맨 위에 보이는지)까지 본다
    const dotsLabel = need('7단계', '⋯');
    const dotsOk = await clickText(cdp, dotsLabel, 'summary');
    await sleep(300);
    const nbOnTop = () => ev(cdp, "(() => { const b = [...document.querySelectorAll('#detail button')].find((x) => x.textContent.includes('주변만 보기')); if (!b) return false; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && b.contains(t); })()");
    check('7단계: 「⋯」를 열면 「주변만 보기」가 눈에 보이고 눌림', dotsOk && (await nbOnTop()));
    await shot(cdp, `${browser.name}-g7-menu`);
    const nbOk = await clickText(cdp, nbLabel || '주변만 보기', '#detail button');
    await sleep(600);
    const after7 = await ev(cdp, 'window.__wu.cy.nodes().length');
    check(`7단계: 「${nbLabel}」 → 이어진 노드만 남음(${before7} → ${after7}개)`, nbOk && after7 < before7 && !!(await ev(cdp, 'window.__wu.nbhd')), JSON.stringify(await ev(cdp, 'window.__wu.nbhd')));
    await shot(cdp, `${browser.name}-g7-nbhd`);
    const backOk7 = await clickText(cdp, allLabel || '전체 보기', '#fit');
    await sleep(600);
    check(`7단계: 「${allLabel}」 → 전체 그래프로 돌아옴`, backOk7 && (await ev(cdp, 'window.__wu.nbhd')) === null && (await ev(cdp, 'window.__wu.cy.nodes().length')) >= before7);
    await clickText(cdp, '← 지도 전체', '#detail button'); // 안내: 카드는 「← 지도 전체」로 닫는다
    await sleep(300);
    // 8단계: 왼쪽 「지도 관리」 → 「업무 지도 묶기」 창을 열어 봄 → 「취소」
    const ok8m = await wsBtn(need('8단계', '지도 관리'));
    const adminText = await panel(cdp);
    check('8단계: 「지도 관리」에 「사람·업무·문서 추가」·「새 업무 지도」·「업무 지도 묶기」·「가져오기·내보내기」·「편집 되감기」', ok8m && ['사람·업무·문서 추가', '새 업무 지도', '업무 지도 묶기', '가져오기·내보내기', '편집 되감기'].every((t) => adminText.includes(t) && labels.includes(t)), `${ok8m} ${adminText.slice(0, 120)}`);
    const groupOk = await clickText(cdp, '업무 지도 묶기', '#detail button');
    await sleep(400);
    const groupOpen = await ev(cdp, "[...document.querySelectorAll('dialog')].some((d) => d.open && d.textContent.includes('묶을 업무 지도'))");
    check('8단계: 「업무 지도 묶기」를 누르면 묶을 지도를 고르는 창이 열림', groupOk && groupOpen);
    await ev(cdp, "(() => { const d = [...document.querySelectorAll('dialog')].find((x) => x.open); const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.trim() === '취소'); if (b) b.click(); return !!b; })()");
    await sleep(300);
    // 안내 3·5절: 「지도 관리」 → 「가져오기·내보내기」 창 안의 읽어 보기·초기화 버튼
    const impOk = await clickText(cdp, '가져오기·내보내기', '#detail button');
    await sleep(400);
    check('안내 5절: 「지도 관리」의 「가져오기·내보내기」 창 안에 「가상 데이터 초기화」 버튼이 있고 머리글에는 없음', impOk && (await ev(cdp, "[...document.querySelectorAll('#import-dialog button')].some((b) => b.textContent.includes('가상 데이터 초기화'))")) && !(await ev(cdp, "[...document.querySelectorAll('header button')].some((b) => b.textContent.includes('가상 데이터 초기화'))")));
    const readTab = await ev(cdp, "[...document.querySelectorAll('#import-dialog button')].some((b) => b.textContent.includes('문서 붙여넣기(읽어 보기)')) && [...document.querySelectorAll('#import-dialog button')].some((b) => b.textContent.trim() === '읽어 보기')");
    check('안내 3절: 가져오기 창에 「문서 붙여넣기(읽어 보기)」 탭과 「읽어 보기」 단추', readTab);
  } finally {
    cdp.close();
    proc.kill();
    await sleep(500);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

console.log(`대상: ${pageUrl}\n안내에서 뽑은 화면 이름: ${labels.join(' / ')}`);
let port = 9600;
for (const b of PICKED) await walk(b, port++);
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과');
process.exit(failures ? 1 : 0);
